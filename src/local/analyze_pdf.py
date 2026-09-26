#!/usr/bin/env python3
import base64, csv, cv2, io, json, math, os, re, subprocess, sys, tempfile
import numpy as np
from pathlib import Path

CANON_W, CANON_H = 1224, 1584


def sh(cmd):
    p = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if p.returncode != 0:
        raise RuntimeError((p.stderr or p.stdout).strip())
    return p.stdout


def render_pdf(pdf, outdir):
    prefix = os.path.join(outdir, 'page')
    sh(['pdftoppm', '-png', '-r', '150', pdf, prefix])
    files = sorted(Path(outdir).glob('page-*.png'), key=lambda p: int(re.search(r'(\d+)$', p.stem).group(1)))
    return [cv2.imread(str(p)) for p in files]


def normalize_page(im, crop_content=False):
    if crop_content:
        g = cv2.cvtColor(im, cv2.COLOR_BGR2GRAY)
        pts = cv2.findNonZero(((g < 245).astype('uint8')) * 255)
        if pts is not None:
            x,y,w,h = cv2.boundingRect(pts)
            pad = 20
            x=max(0,x-pad); y=max(0,y-pad)
            w=min(im.shape[1]-x,w+2*pad); h=min(im.shape[0]-y,h+2*pad)
            im = im[y:y+h, x:x+w]
    return cv2.resize(im, (CANON_W, CANON_H), interpolation=cv2.INTER_AREA)




def normalize_lot_page(im):
    """Normalize a Lot Log by the actual form content, not the PDF canvas.

    Some test PDFs are portrait pages while others place the same portrait form on
    a landscape canvas. Resizing the whole canvas shifts every table cell. Cropping
    to the form's non-white bounding box first makes both variants align.
    """
    g = cv2.cvtColor(im, cv2.COLOR_BGR2GRAY)
    pts = cv2.findNonZero(((g < 245).astype('uint8')) * 255)
    if pts is None:
        return cv2.resize(im, (CANON_W, CANON_H), interpolation=cv2.INTER_AREA)
    x, y, w, h = cv2.boundingRect(pts)
    pad = 8
    x = max(0, x-pad); y = max(0, y-pad)
    w = min(im.shape[1]-x, w+2*pad); h = min(im.shape[0]-y, h+2*pad)
    return cv2.resize(im[y:y+h, x:x+w], (CANON_W, CANON_H), interpolation=cv2.INTER_AREA)


def deskew_form(im):
    """Use long table rules to straighten the scan before locating writing areas."""
    gray = cv2.cvtColor(im, cv2.COLOR_BGR2GRAY)
    bw = cv2.threshold(gray, 180, 255, cv2.THRESH_BINARY_INV)[1]
    lines = cv2.HoughLinesP(bw, 1, np.pi / 1800, 200, minLineLength=500, maxLineGap=20)
    angles = []
    if lines is not None:
        for x1, y1, x2, y2 in lines[:, 0]:
            if abs(y2-y1) < abs(x2-x1) * 0.05:
                angles.append(math.degrees(math.atan2(y2-y1, x2-x1)))
    if not angles:
        return im
    angle = float(np.median(angles))
    matrix = cv2.getRotationMatrix2D((im.shape[1]/2, im.shape[0]/2), angle, 1)
    return cv2.warpAffine(im, matrix, (im.shape[1], im.shape[0]), borderValue=(255,255,255))


def horizontal_rules(im, x1, x2, y1, y2):
    """Find actual row boundaries; do not accumulate a guessed row-height offset."""
    gray = cv2.cvtColor(im, cv2.COLOR_BGR2GRAY)
    ys = np.where((gray[y1:y2, x1:x2] < 180).mean(axis=1) > 0.65)[0] + y1
    groups = np.split(ys, np.where(np.diff(ys) > 1)[0]+1)
    return [float(np.median(g)) for g in groups if len(g)]


def row_boxes(im, x1, x2, y1, y2, min_height, max_height):
    rules = horizontal_rules(im, x1, x2, y1, y2)
    return [(a, b) for a, b in zip(rules, rules[1:]) if min_height <= b-a <= max_height]

def ocr_image(im, psm=6, whitelist=None):
    fd, fn = tempfile.mkstemp(suffix='.png'); os.close(fd)
    try:
        cv2.imwrite(fn, im)
        cmd = ['tesseract', fn, 'stdout', '--psm', str(psm)]
        if whitelist:
            cmd += ['-c', f'tessedit_char_whitelist={whitelist}']
        return sh(cmd).strip()
    except Exception:
        return ''
    finally:
        try: os.unlink(fn)
        except OSError: pass


def ocr_with_confidence(im, psm=7, whitelist=None):
    """Use measured OCR certainty instead of assigning handwriting 90%."""
    if im.size == 0:
        return '', 0.0
    fd, filename = tempfile.mkstemp(suffix='.png'); os.close(fd)
    try:
        cv2.imwrite(filename, im)
        cmd = ['tesseract', filename, 'stdout', '--psm', str(psm)]
        if whitelist:
            cmd += ['-c', f'tessedit_char_whitelist={whitelist}']
        words = [r for r in csv.DictReader(io.StringIO(sh(cmd + ['tsv'])), delimiter='\t')
                 if r.get('text', '').strip() and float(r.get('conf', -1)) >= 0]
        text = ' '.join(r['text'] for r in words)
        weight = sum(len(r['text']) for r in words)
        confidence = sum(float(r['conf']) * len(r['text']) for r in words) / (100 * weight) if weight else 0.0
        return text, confidence
    finally:
        try: os.unlink(filename)
        except OSError: pass


def crop(im, box, margin=2):
    x1,y1,x2,y2 = box
    x1=max(0,int(x1+margin)); y1=max(0,int(y1+margin)); x2=min(im.shape[1],int(x2-margin)); y2=min(im.shape[0],int(y2-margin))
    return im[y1:y2,x1:x2]


def clean_ink(c):
    """Return foreground ink while preserving narrow handwritten strokes.

    Older versions removed vertical/horizontal components with morphology.  That
    accidentally erased handwritten values such as a single "1" in Qty Used
    and Load # cells.  Cells are already cropped inside their borders, so here we
    keep real strokes and reject only long, thin border fragments component-wise.
    """
    if c.size == 0:
        return None
    g = cv2.cvtColor(c, cv2.COLOR_BGR2GRAY) if len(c.shape) == 3 else c.copy()
    g = cv2.GaussianBlur(g, (3, 3), 0)
    return cv2.threshold(g, 205, 255, cv2.THRESH_BINARY_INV)[1]


def ink_metrics(im, box, margin=5):
    c = crop(im, box, margin)
    bw = clean_ink(c)
    if bw is None or bw.size == 0:
        return 0.0, 0

    n, labels, stats, _ = cv2.connectedComponentsWithStats(bw, 8)
    kept_area = 0
    comps = 0
    H, W = bw.shape[:2]
    for i in range(1, n):
        area = int(stats[i, cv2.CC_STAT_AREA])
        x = int(stats[i, cv2.CC_STAT_LEFT]); y = int(stats[i, cv2.CC_STAT_TOP])
        w = int(stats[i, cv2.CC_STAT_WIDTH]); h = int(stats[i, cv2.CC_STAT_HEIGHT])

        # Ignore tiny scanner specks.  A thin handwritten "1" is intentionally
        # retained (typically width 2-6px, height 8-18px at our normalized size).
        if area < 3 or max(w, h) < 3:
            continue

        # A thin component on a crop edge is usually a skewed cell border.
        # Do not discard an interior tall/narrow component: that may be a handwritten
        # digit "1" and was the source of false blank detections.
        # Only treat a long thin component as a border when it lies at the
        # corresponding crop edge. A handwritten "1" may touch the top/bottom
        # edge but sits inside the cell horizontally and must be preserved.
        vertical_edge = (x <= 1 or (x + w) >= W - 1)
        horizontal_edge = (y <= 1 or (y + h) >= H - 1)
        if (vertical_edge and h >= int(H * 0.80) and w <= 3) or \
           (horizontal_edge and w >= int(W * 0.80) and h <= 3):
            continue

        kept_area += area
        comps += 1

    ratio = float(kept_area) / float(bw.size)
    return ratio, comps


def present(im, box, min_ratio=0.0012, min_comps=1, margin=5):
    ratio, comps = ink_metrics(im, box, margin)
    return ratio >= min_ratio and comps >= min_comps, ratio, comps


def cell_value(im, box, psm=7):
    # Trim more aggressively so table borders and neighboring handwriting do not
    # get mistaken for content in an otherwise blank cell.
    c = crop(im, box, 6)
    txt = ocr_image(c, psm=psm)
    txt = re.sub(r'\s+', ' ', txt).strip()
    # Common OCR border artifacts are not real field values.
    if not re.search(r'[A-Za-z0-9]', txt):
        return ''
    # Normalize obvious N/A variants while preserving all other text.
    compact = re.sub(r'[^A-Za-z]', '', txt).upper()
    if compact == 'NA':
        return 'N/A'
    return txt.strip(' |_:;,.')


def item_image(im, box):
    """Keep the exact handwritten name available instead of inventing OCR text."""
    c = crop(im, box, 2)
    ok, png = cv2.imencode('.png', c)
    return 'data:image/png;base64,' + base64.b64encode(png).decode('ascii') if ok else ''



def raw_ink_ratio(im, box, margin=4, threshold=180):
    c = crop(im, box, margin)
    if c.size == 0:
        return 0.0
    g = cv2.cvtColor(c, cv2.COLOR_BGR2GRAY) if len(c.shape)==3 else c
    return float((g < threshold).sum()) / g.size

def conf_from_presence(is_present, ratio):
    if not is_present: return 0.98
    return min(0.95, 0.65 + ratio*8)


def page_obj(n):
    return {
        'page': n, 'topFields': [],
        'operationsManagerReview': {'present':False,'initials':'','date':'','confidence':1,'hasVisibleMark':False},
        'productRows': [], 'reviewRows': [],
        'item10': {'incNumber':'','status':'','confidence':1},
        'lotItems': [], 'regenMedItems': [], 'sterilizationItems': [], 'packagingItems': [], 'discard': None
    }


def classify(first):
    txt = ocr_image(first, 6).upper()
    scores = {
        'MP-F-023': sum(k in txt for k in ['PROCESSING INSTRUCTIONS','TISSUE OPEN','OPERATIONS MANAGER REVIEW','# PRODUCED','# PACKAGED']),
        'QS-F-049': sum(k in txt for k in ['TECHNICAL/QUALITY REVIEW','REVIEWED BY/DATE','TECHNICAL AND QUALITY REVIEW ELEMENTS','CROSS-REFERENCE']),
        'LOT_LOG': sum(k in txt for k in ['PROCESSING & PACKAGING LOT','LOT NUMBER','MANUFACTURER','STERILIZATION DATE','REGENMED ITEM']),
        'DISCARD_FORM': sum(k in txt for k in ['TISSUE DISCARD FORM','REASON FOR DISCARD','DISCARD AUTHORIZED','TISSUE DISCARDED BY','MP-F-018'])
    }
    kind = max(scores, key=scores.get)
    best = scores[kind]
    return (kind if best >= 2 else 'UNKNOWN'), min(0.99, 0.45 + 0.11*best), txt


def split_by_date(im, box):
    # By/Date cells on MP-F-023 use two visual lines: initials on the upper line
    # and the date on the lower line.  The older implementation accidentally
    # sampled only a narrow strip around the middle of the cell, so valid initials
    # such as KS/MW were missed even though the date was detected.
    x1,y1,x2,y2 = box
    h = y2-y1

    # Inspect the full upper and lower writing bands.  A small overlap tolerates
    # handwriting that crosses the midline, while crop margins/edge filtering in
    # present() prevent table borders from counting as handwriting.
    upper_box = (x1, y1, x2, y1 + h*0.52)
    lower_box = (x1, y1 + h*0.46, x2, y2)
    p1,r1,_ = present(im, upper_box, 0.005, margin=4)
    p2,r2,_ = present(im, lower_box, 0.005, margin=4)

    full = cell_value(im, box, 6)
    date = ''
    m = re.search(r'\b(?:0?[1-9]|1[0-2])[\-/\.](?:0?[1-9]|[12]\d|3[01])[\-/\.](?:\d{2}|\d{4})\b', full)
    if m:
        date = m.group(0)
    elif p2:
        # The MP-F-023 rule only requires that a date be present; OCR can be poor
        # on handwriting, so visible writing in the lower line is sufficient.
        date = 'MARK'

    initials = 'MARK' if p1 else ''
    return initials, date, (p1 or p2), min(0.95, 0.65 + max(r1,r2)*8)


def analyze_mp(im):
    im = deskew_form(im)
    p = page_obj(1)
    # boxes are intentionally inside editable areas; all coordinates use a normalized 1224x1584 page.
    fields = [
      ('Donor # Verified By',(67,182,205,226),'value'),
      ('Cross Reference #',(205,183,322,226),'value'),
      ('Donor Sex',(322,183,395,226),'value'),
      ('Donor Age',(395,183,467,226),'value'),
      ('Date of Recovery',(467,183,566,226),'value'),
      ('Instruction Verification',(566,184,766,226),'value'),
      ('Date of Processing',(766,183,873,226),'value'),
      ('Clean Room Log Review By / Date',(873,166,1028,227),'by_date'),
      ('Tissue Checked In By / Date',(1028,166,1174,227),'by_date')]
    for label,b,kind in fields:
        if kind == 'by_date':
            ini,date,mark,cf = split_by_date(im,b)
            p['topFields'].append({'label':label,'value':'','initials':ini,'date':date,'kind':'by_date','confidence':cf,'hasVisibleMark':mark})
        else:
            yes,ratio,_ = present(im,b,0.004)
            txt = cell_value(im,b,7) if yes else ''
            p['topFields'].append({'label':label,'value':txt or ('MARK' if yes else ''),'initials':'','date':'','kind':'value','confidence':conf_from_presence(yes,ratio),'hasVisibleMark':yes})
    # Donor verification has two separate signature boxes. One signature must
    # not make an empty neighbouring verification pass.
    donor = p['topFields'][0]
    donor['requiredParts'] = []
    for label, box in [('First verification initials', (67,182,136,226)),
                       ('Second verification initials', (136,182,205,226))]:
        yes, ratio, _ = present(im, box, 0.004)
        donor['requiredParts'].append({'label':label, 'value':'MARK' if yes else '',
                                      'confidence':conf_from_presence(yes,ratio)})
    # Operations Manager Review is written horizontally: initials followed by date.
    # Start AFTER the printed MM/DD/YY label, inside the actual review row.
    om_initials=(617,710,677,746); om_date=(677,710,1170,746)
    oi,oir,_=present(im,om_initials,0.0015,margin=2); od,odr,_=present(im,om_date,0.0015,margin=2)
    p['operationsManagerReview']={'present':bool(oi or od),'initials':'MARK' if oi else '', 'date':'MARK' if od else '',
                                  'confidence':min(conf_from_presence(oi,oir),conf_from_presence(od,odr)),
                                  'hasVisibleMark':bool(oi or od)}

    names=['Posterior Tibialis','Anterior Tibialis','Peroneus Longus','Gracilis','Semitendinosus','Patellar Ligament','Femoral Head','Humeral Head','Tri-Cortical Block','Cancellous 1-10 mm','Cancellous 4-10 mm','Cancellous 1-4 mm','Cancellous 3-6 mm','Tibia Shaft','Humerus Shaft','Femur Shaft','Fibula Shaft']
    # manually measured row centers; blank separator rows are skipped.
    bounds = row_boxes(im, 100, 1100, 770, 1368, 20, 31)
    indices = [0,1,2,3,4,6,8,9,11,13,14,15,16,18,19,20,21]
    if len(bounds) < 22:
        # Unrecognized geometry must be reviewed, never silently passed using
        # rectangles that might sample a border or a neighbouring row.
        p['productRows'] = [{'item':name, 'produced':'', 'packaged':'',
                            'producedApplicable':True, 'packagedApplicable':True,
                            'confidence':0.0} for name in names]
        return p
    for name, index in zip(names,indices):
        y1,y2 = bounds[index]
        prod=(584,y1,709,y2); pack=(709,y1,836,y2)
        py,pr,_=present(im,prod,0.003,margin=4); qy,qr,_=present(im,pack,0.003,margin=4)
        p['productRows'].append({'item':name,'produced':'MARK' if py else '','packaged':'MARK' if qy else '',
                                 'producedApplicable':True,'packagedApplicable':True,
                                 'confidence':min(conf_from_presence(py,pr),conf_from_presence(qy,qr))})
    return p


def qs_cell(im, box):
    x1,y1,x2,y2 = box
    enlarged = cv2.resize(crop(im,box,4),None,fx=3,fy=3,interpolation=cv2.INTER_CUBIC)
    full, full_conf = ocr_with_confidence(enlarged,6)
    evidence = item_image(im,box)
    compact = re.sub(r'\s+','',full).upper()
    if re.fullmatch(r'N[/\\I]?A',compact):
        return {'raw':full,'initials':'','date':'','isNA':True,'confidence':full_conf,
                'hasVisibleMark':True,'reviewImage':evidence,'dateImage':evidence}
    split = y1 + (y2-y1)*0.48
    top_box=(x1,y1,x2,split)
    date_box=(x1,y1+(y2-y1)*0.38,x2,y2)
    ip,ir,_=present(im,top_box,0.008,margin=4)
    dp,dr,_=present(im,date_box,0.008,margin=4)
    date_text=''
    date_conf=0.0
    if dp:
        date_im=cv2.resize(crop(im,date_box,4),None,fx=3,fy=3,interpolation=cv2.INTER_CUBIC)
        candidates=[ocr_with_confidence(date_im,7),ocr_with_confidence(date_im,7,'0123456789/-.')]
        # An uncertain transcription must not be presented as a format error.
        readings=[]
        for text,cf in candidates:
            value=re.sub(r'\s*([/.-])\s*',r'\1',text.strip())
            if re.fullmatch(r'\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}',value):
                readings.append((value,cf))
        if readings:
            date_text,date_conf=max(readings,key=lambda r:r[1])
            if len({v for v,c in readings if c >= .65}) > 1:
                date_conf=0.4
        else:
            date_text='MARK'
    return {'raw':full,'initials':'MARK' if ip else '', 'date':date_text,'isNA':False,
            'confidence':conf_from_presence(ip or dp,max(ir,dr)),
            'initialsConfidence':conf_from_presence(ip,ir),'dateConfidence':date_conf,
            'hasVisibleMark':bool(ip or dp),'hasInitialsMark':ip,'hasDateMark':dp,
            'reviewImage':evidence,'dateImage':item_image(im,date_box)}


def analyze_qs(im):
    im=deskew_form(im)
    p=page_obj(1)
    tech_x=(944,1057); qual_x=(1057,1170)
    row_bounds=row_boxes(im,85,1160,240,945,40,140)
    if len(row_bounds) != 10:
        p['reviewImage']=item_image(im,(78,240,1173,945))
        p['item10']={'incNumber':'','status':'','confidence':0.0,'statusFieldFound':False,
                     'statusImage':item_image(im,(135,840,943,935))}
        return p
    for idx,(y1,y2) in enumerate(row_bounds,1):
        p['reviewRows'].append({'item':str(idx),'technical':qs_cell(im,(tech_x[0],y1,tech_x[1],y2)),
                               'quality':qs_cell(im,(qual_x[0],y1,qual_x[1],y2))})
    y1,y2=row_bounds[-1]
    # Only inspect writing AFTER Status:, below the printed paragraph.
    inc_box=(190,y2-35,413,y2)
    status_label=(417,y2-36,483,y2)
    status_box=(483,y2-38,940,y2)
    ip,ir,_=present(im,inc_box,0.004,margin=4)
    sp,sr,_=present(im,status_box,0.004,margin=4)
    label_text=ocr_image(cv2.resize(crop(im,status_label,2),None,fx=3,fy=3),7)
    status,cf=ocr_with_confidence(cv2.resize(crop(im,status_box,4),None,fx=3,fy=3),7) if sp else ('',.98)
    p['item10']={'incNumber':cell_value(im,inc_box,7) if ip else '', 'status':status or ('MARK' if sp else ''),
                 'confidence':cf,'statusConfidence':cf,'statusFieldFound':bool(re.search(r'status',label_text,re.I)),
                 'statusHasVisibleMark':sp,'statusImage':item_image(im,(413,y2-46,943,y2+2))}
    return p


def analyze_lot_page1(im):
    p=page_obj(1)
    for section, box in [('Processing', (200,235,383,311)),
                         ('Packaging', (200,457,383,534))]:
        yes, ratio, _ = present(im, box, 0.004, margin=8)
        p['topFields'].append({'label':section + ' Room RH', 'kind':'value',
                              'value':'MARK' if yes else '', 'initials':'', 'date':'',
                              'confidence':conf_from_presence(yes,ratio), 'hasVisibleMark':yes})
    labels=['Process Pack','Gown (L)','Gloves (7)','Gloves (7.5)','Gloves','H2O 1000 mL','IPA 70% 500mL','H2O2 4L','Saline 0.9%','Detergent (Brij-35)','Pipettes','Pulse Lavage','Blades','Bowl','Table Cover','Sutures','Gauze','Fascia Gauze','Absorbent Towel','IPA 70% 4 L','H2O 1000 mL','H2O2 500 mL','H2O 1000 mL']

    # Page-1 table grid after normalization.  The previous implementation used
    # overlapping column rectangles, which caused text from the neighbouring
    # cell to make an actually blank field look populated.
    # Grid: Item | Lot Number | Exp. Date | Manufacturer
    x_item_l, x_lot, x_exp, x_mfr, x_right = 16, 300, 614, 867, 1210
    first_center, row_h = 594, 31.0
    for i,name in enumerate(labels):
        yc=first_center+i*row_h
        boxes={
            'lotNumber':(x_lot+3,yc-11,x_exp-3,yc+11),
            'expirationDate':(x_exp+3,yc-11,x_mfr-3,yc+11),
            'manufacturer':(x_mfr+3,yc-11,x_right-3,yc+11)
        }
        vals={}; conf=1.0
        for key,b in boxes.items():
            yes,r,comps=present(im,b,0.0025,min_comps=1,margin=5)
            # Lot Log rules only require presence/N-A, not exact transcription.
            # Using OCR text here caused false PASSes from neighbouring/erased text.
            val = 'MARK' if yes else ''
            vals[key]=val
            conf=min(conf,conf_from_presence(yes,r))
        p['lotItems'].append({'item':name,**vals,'confidence':conf})

    regen=['Labels','Poly Bags (15)','Poly Bags','Kapton Cover']
    # RegenMed grid: Item | Lot | Qty Used. Header is 1343-1371.
    x_left, x_lot, x_qty, x_right = 16, 457, 867, 1210
    first_center, row_h = 1388, 31.0
    for i,name in enumerate(regen):
        yc=first_center+i*row_h
        lb=(x_lot+3,yc-11,x_qty-3,yc+11)
        qb=(x_qty+3,yc-11,x_right-3,yc+11)
        lp,lr,_=present(im,lb,0.0025,margin=5); qp,qr,_=present(im,qb,0.0025,margin=5)
        lv='MARK' if lp else ''; qv='MARK' if qp else ''
        p['regenMedItems'].append({'item':name,'lot':lv, 'qtyUsed':qv,
                                   'confidence':min(conf_from_presence(lp,lr),conf_from_presence(qp,qr))})
    return p


def analyze_lot_page2(im):
    p=page_obj(2)

    left_names = ['BS Small Tray', 'BS Large Tray', 'BS Base', 'BS Lower Section',
                  'BS Lower Wheel', 'BS Upper Section', 'BS Sub Surface', 'BS Inner Hanger',
                  'BS Outer Hanger', 'BS Upper Wheel', 'BS SS Surface', 'BS Door',
                  'BS Blade', 'BS Blade', 'Processing Tray', 'Centrifuge Tray', 'Bone Mill Tray',
                  'Reaming Bit', 'Drill', 'Drill Battery', 'Caliper', 'Caliper',
                  'Mayo Tray', 'Mayo Tray', 'Mayo Tray', 'Metal Glove', 'Metal Glove', 'Metal Glove',
                  'Sieve 1mm', 'Large Round Basin', 'Large Round Basin', 'Large Basin', 'Large Basin',
                  'Large Basin', 'Medium Basin', 'Medium Basin', 'Medium Basin', 'Medium Basin',
                  'Medium Basin Lid', 'Medium Basin Lid', 'Packaging Tray',
                  'Small Round Basin', 'Small Round Basin', 'Small Round Basin', 'Small Round Basin']
    right_names = ['Small Round Basin']*4 + ['Small Round Basin Lid']*8 + ['Sieve']*4 + [
        'Tendon Sizer', 'Measuring Cups', 'Ruler']

    def item_name(box, fallback=''):
        # The former 10px-high crop cut handwritten names in half. Read the full
        # writing area at twice its size, including sizes written beside names.
        if fallback and fallback != 'Sieve':
            return fallback
        if not fallback:
            return 'Handwritten item'
        c = crop(im, box, 3)
        txt = ocr_image(cv2.resize(c, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC), 7)
        txt = re.sub(r'\s+', ' ', txt).strip(' |_:;,.')
        if fallback:
            # Printed names are part of this known form layout. Do not replace
            # them with OCR gibberish; retain legible handwritten qualifiers.
            if fallback == 'Sieve':
                size = re.search(r'(\d+(?:[.,]\d+)?)\s*m[mn]', txt, re.I)
                if size:
                    return 'Sieve ' + size.group(1).replace(',', '.') + 'mm'
            return fallback
        if re.search(r'[A-Za-z0-9]', txt):
            return txt
        return 'Unreadable item name'

    def table_rows(cols, bottom, names, side):
        x_left,x_load,x_date,x_right=cols
        rows=[]
        bounds = row_boxes(im, x_left+8, x_right-8, 115, bottom, 24, 38)
        for i,(y1,y2) in enumerate(bounds):
            item_box=(x_left,y1,x_load,y2)
            item_ratio,item_comps=ink_metrics(im,item_box,margin=5)
            # Item names contain several strokes/letters. Requiring more than a
            # single weak component prevents a scan speck from activating an empty row.
            item_present=(item_comps >= 2 and item_ratio >= 0.003) or item_ratio >= 0.025
            if not item_present:
                continue
            item_txt=item_name(item_box, names[i] if i < len(names) else '')
            lb=(x_load,y1,x_date,y2)
            db=(x_date,y1,x_right,y2)
            lp,lr,_=present(im,lb,0.0025,margin=5); dp,dr,_=present(im,db,0.0025,margin=5)
            lv='MARK' if lp else ''; dv='MARK' if dp else ''
            # In this Lot Log template two Sieve slots on the right-hand table are
            # optional and are blank in a correctly completed reference form.
            # More generally, rows with no item ink and no values are ignored.
            if side == 'Right' and i in (14, 15) and not lp and not dp:
                continue
            rows.append({'item':item_txt,
                         'rowId':f'{side.lower()}-{i+1}', 'location':f'{side}, row {i+1}',
                         'itemImage':item_image(im,item_box) if i >= len(names) or names[i] == 'Sieve' else '',
                         'loadNumber':lv,
                         'sterilizationDate':dv,
                         'confidence':min(conf_from_presence(lp,lr),conf_from_presence(dp,dr))})
        return rows

    # Page-2 grid is offset substantially to the right compared with the old
    # rectangles.  Using the real non-overlapping cells fixes false PASSes.
    # left:  Item | Load # | Sterilization Date
    p['sterilizationItems'] += table_rows((10,286,394,584),1510,left_names,'Left')
    # right: Item | Load # | Sterilization Date
    p['sterilizationItems'] += table_rows((613,920,1029,1213),1110,right_names,'Right')

    # Packaging table: Packaging | Lot | Qty Used
    x_left,x_lot,x_qty,x_right=613,795,1029,1213
    bounds = row_boxes(im, x_left+8, x_right-8, 1155, 1510, 24, 38)
    for i,(y1,y2) in enumerate(bounds):
        ib=(x_left,y1,x_lot,y2)
        iratio,icomps=ink_metrics(im,ib,margin=5)
        # Descenders from the preceding handwritten name can spill into a blank
        # spare row. A real item name occupies substantially more ink than that.
        ip=(icomps >= 2 and iratio >= 0.015) or iratio >= 0.025
        if not ip:
            continue
        item='Packaging item'
        lb=(x_lot,y1,x_qty,y2)
        qb=(x_qty,y1,x_right,y2)
        lp,lr,_=present(im,lb,0.0025,margin=5); qp,qr,_=present(im,qb,0.0025,margin=5)
        lv='MARK' if lp else ''; qv='MARK' if qp else ''
        p['packagingItems'].append({'item':item or f'Packaging row {i+1}',
                                    'rowId':f'packaging-{i+1}', 'location':f'Row {i+1}',
                                    'itemImage':item_image(im,(x_left,y1-4,x_lot,y2+2)),
                                    'lot':lv,
                                    'qtyUsed':qv,
                                    'confidence':min(conf_from_presence(lp,lr),conf_from_presence(qp,qr))})
    return p


DISCARD_STATUSES = ['Unprocessed Tissue', 'In Processing Tissue',
                    'Unreleased Packaged Tissue', 'Released Packaged Tissue']


def normalize_discard_page(im):
    """Align all sections to the outer rules, tolerating scan translation/skew."""
    im = deskew_form(normalize_page(im))
    rules = horizontal_rules(im, 150, 1100, 150, 1420)
    if len(rules) < 20:
        return None
    top, bottom = int(rules[0]), int(rules[-1])
    bw = cv2.threshold(cv2.cvtColor(im, cv2.COLOR_BGR2GRAY), 180, 255, cv2.THRESH_BINARY_INV)[1]
    lines = cv2.morphologyEx(bw, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (500,1)))
    points = cv2.findNonZero(lines[top:bottom+1])
    if points is None:
        return None
    x, _, w, _ = cv2.boundingRect(points)
    if not (1000 < w < 1200 and 1100 < bottom-top < 1280):
        return None
    return cv2.resize(im[top:bottom+1, x:x+w], (1100,1200), interpolation=cv2.INTER_AREA)


def discard_text(im, box, numeric=False):
    c = crop(im, box, 3)
    c = cv2.resize(c, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC)
    return re.sub(r'\s+', ' ', ocr_image(c, 7, '0123456789/-' if numeric else None)).strip(' |_')


def discard_value(im, box, date=False, allow_na=False):
    yes, ratio, _ = present(im, box, 0.004, margin=4)
    field = {'value':'MARK' if yes else '', 'confidence':conf_from_presence(yes,ratio), 'hasVisibleMark':yes}
    if not yes:
        return field
    text = discard_text(im, box)
    if allow_na and re.fullmatch(r'[NMWV]\s*[/I1\\]?\s*A', text, re.I):
        field['value'] = 'N/A'
        return field
    if not date:
        field['value'] = text or 'MARK'
        return field
    # Both separators are retained. OCR spacing around separators is harmless;
    # ambiguous handwriting stays MARK for manual review, never a made-up date.
    for candidate in [text, discard_text(im, box, numeric=True)]:
        candidate = re.sub(r'\s*([/-])\s*', r'\1', candidate)
        match = re.search(r'(?<!\d)\d{2}([/-])\d{2}\1(?:\d{4}|\d{2})(?!\d)', candidate)
        if match:
            field['value'] = match.group(0)
            field['confidence'] = 0.9
            return field
    field['confidence'] = 0.4
    return field


def discard_graft(im, box):
    yes, ratio, comps = present(im, box, 0.004, margin=5)
    if not yes:
        return '', 'blank'
    bw = clean_ink(crop(im,box,5))
    points = cv2.findNonZero(bw)
    _, _, w, h = cv2.boundingRect(points)
    if h < 16 and w > 4*h and comps <= 2:
        return '-', 'dash'
    text = discard_text(im, box)
    if re.fullmatch(r'[-\u2013\u2014_~\s]+',text):
        return '-', 'dash'
    compact = re.sub(r'[^A-Za-z]', '', text).upper()
    if compact in ('NA','NIA','NLA','MA','WA') and not re.search(r'\d',text):
        return 'N/A', 'na'
    if re.search(r'\d{3,}',text) or len(re.sub(r'[^A-Za-z0-9]','',text)) >= 4:
        return text, 'id'
    return text or 'MARK', 'unknown'


def analyze_discard_page(raw, number):
    p = page_obj(number)
    im = normalize_discard_page(raw)
    empty = {'value':'', 'confidence':0.0, 'hasVisibleMark':False}
    data = {'layoutDetected':im is not None, 'tissuesDetected':False,
            'donorNumber':dict(empty), 'reason':dict(empty),
            'authorization':{'initials':dict(empty), 'date':dict(empty)},
            'tissueStatuses':[], 'tissues':[], 'bottomFields':[]}
    p['discard'] = data
    if im is None:
        return p
    data['donorNumber'] = discard_value(im,(94,1,286,38))
    data['reason'] = discard_value(im,(195,40,1095,84))
    # Initials begin immediately after the printed label; the date follows them.
    # A long signature can extend into the date area, so unreadable date ink must
    # be reviewed rather than allowing the signature alone to satisfy both.
    data['authorization'] = {
        'initials':discard_value(im,(701,1,768,38)),
        'date':discard_value(im,(775,1,1096,38),date=True)
    }
    for label,x in zip(DISCARD_STATUSES,[108,317,530,815]):
        ratio, _ = ink_metrics(im,(x-7,105,x+7,121),3)
        data['tissueStatuses'].append({'label':label,'checked':ratio >= 0.10,
                                       'confidence':0.98 if ratio < 0.02 or ratio >= 0.10 else 0.4})
    bounds = row_boxes(im,15,1080,200,983,36,49)
    data['tissuesDetected'] = len(bounds) == 18
    for i,(y1,y2) in enumerate(bounds):
        desc_box = (203,y1,881,y2)
        listed, ratio, comps = present(im,desc_box,0.004,min_comps=2,margin=5)
        # A stray descender from the bottom signature is not a listed tissue.
        if not listed:
            continue
        graft, kind = discard_graft(im,(4,y1,194,y2))
        checked, cr, _ = present(im,(1072,y1,1098,y2),0.015,margin=5)
        data['tissues'].append({'item':'Listed tissue', 'itemImage':item_image(im,desc_box),
                               'rowId':f'tissue-{i+1}', 'location':f'Row {i+1}',
                               'graftId':graft, 'graftIdKind':kind,
                               'confirmed':checked, 'confirmationConfidence':0.98 if cr < 0.004 or checked else 0.4})
    for label,box in [
        ('Tissue Discarded By',(211,983,352,1034)),
        ('Confirmed By',(502,983,703,1034)),
        ('Discard Date',(897,983,1096,1034)),
        ('FreezerPro Updated By',(459,1061,703,1116)),
        ('FreezerPro Updated Date',(906,1061,1096,1116)),
        ('Log / FreezerPro Updated By',(515,1145,704,1198)),
        ('Log / FreezerPro Updated Date',(901,1145,1096,1198))
    ]:
        data['bottomFields'].append({'label':label, **discard_value(im,box,date=label.endswith('Date'),allow_na=True)})
    return p


def main():
    pdf=sys.argv[1]
    with tempfile.TemporaryDirectory(prefix='qc-render-') as td:
        raw=render_pdf(pdf,td)
        if not raw: raise RuntimeError('PDF contains no renderable pages')
        first_for_class=normalize_page(raw[0], crop_content=(raw[0].shape[1] > raw[0].shape[0]))
        form,confidence,_=classify(first_for_class)
        pages=[]; warnings=[]
        if form=='MP-F-023':
            pages=[analyze_mp(normalize_page(raw[0],False))]
        elif form=='QS-F-049':
            pages=[analyze_qs(normalize_page(raw[0],False))]
        elif form=='LOT_LOG':
            norm=[normalize_lot_page(x) for x in raw]
            pages=[analyze_lot_page1(norm[0])]
            if len(norm)>1: pages.append(analyze_lot_page2(norm[1]))
            else: warnings.append('Lot Log page 2 was not found.')
        elif form=='DISCARD_FORM':
            pages=[analyze_discard_page(im,i+1) for i,im in enumerate(raw)]
        else:
            pages=[page_obj(i+1) for i in range(len(raw))]
        print(json.dumps({'formType':form,'classificationConfidence':confidence,'pages':pages,'warnings':warnings}))

if __name__=='__main__':
    try: main()
    except Exception as e:
        print(json.dumps({'error':str(e)}), file=sys.stderr)
        sys.exit(1)
