const cell=(initials,date)=>({raw:`${initials} ${date}`,initials,date,isNA:false,confidence:.95,hasVisibleMark:true});
const na=()=>({raw:"N/A",initials:"",date:"",isNA:true,confidence:.99,hasVisibleMark:true});
export default { formType:"QS-F-049", classificationConfidence:.99, warnings:[], pages:[{ page:1, topFields:[], operationsManagerReview:{present:false,initials:"",date:"",confidence:1,hasVisibleMark:false}, productRows:[],
reviewRows:[1,2,3,4,5,6,7,8].map(n=>({item:String(n),technical:cell("MM","11/27/24"),quality:cell("LC","11/29/24")})).concat([{item:"9",technical:na(),quality:na()},{item:"10",technical:cell("MM","11/27/24"),quality:cell("LC","12/05/24")}]),
item10:{incNumber:"CT-60,263",status:"open; closed",confidence:.9}, lotItems:[],regenMedItems:[],sterilizationItems:[],packagingItems:[] }] };
