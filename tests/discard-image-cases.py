"""Controlled blank/checkbox cases derived locally from the supplied scan.

Only in-memory images are edited; the input PDF is never changed.
"""
import json, sys, tempfile
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1] / 'src' / 'local'))
import analyze_pdf as a

with tempfile.TemporaryDirectory() as td:
    raw=a.render_pdf(sys.argv[1],td)
    original=a.normalize_discard_page(raw[0])

def analyze(im):
    with patch.object(a,'normalize_discard_page',return_value=im):
        return {'formType':'DISCARD_FORM','pages':[a.analyze_discard_page(im,1)]}

def erase(im,box):
    x1,y1,x2,y2=box
    im[y1:y2,x1:x2]=255

blank=original.copy()
for box in [(94,2,285,36),(195,41,1095,83),(699,2,1096,36),
            (212,984,351,1032),(503,984,702,1032),(898,984,1095,1032),
            (460,1062,702,1114),(907,1062,1095,1114),
            (516,1146,703,1197),(902,1146,1095,1197),
            (1076,213,1094,247)]:
    erase(blank,box)
# Only remove ink inside the selected checkbox, retaining the printed square.
erase(blank,(313,108,321,118))

packaged=original.copy()
erase(packaged,(313,108,321,118))
a.cv2.line(packaged,(811,108),(819,118),(0,0,0),2)
a.cv2.line(packaged,(819,108),(811,118),(0,0,0),2)
erase(packaged,(7,211,193,249))
a.cv2.putText(packaged,'22043-001',(13,238),a.cv2.FONT_HERSHEY_SIMPLEX,.65,(0,0,0),1,a.cv2.LINE_AA)

missing_date=original.copy()
erase(missing_date,(776,2,1096,36))
missing_initials=original.copy()
erase(missing_initials,(701,2,768,36))

print(json.dumps({'blank':analyze(blank),'packaged':analyze(packaged),
                  'missingDate':analyze(missing_date),'missingInitials':analyze(missing_initials)}))
