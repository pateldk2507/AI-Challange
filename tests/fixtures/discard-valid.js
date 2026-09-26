const field = value => ({value,confidence:.99,hasVisibleMark:true});
export default {
  formType:"DISCARD_FORM",classificationConfidence:.99,pages:[{
    page:1,discard:{
      layoutDetected:true,tissuesDetected:true,donorNumber:field("22043"),reason:field("Production goals"),
      authorization:{initials:field("KS"),date:field("01-20-25")},
      tissueStatuses:["Unprocessed Tissue","In Processing Tissue","Unreleased Packaged Tissue","Released Packaged Tissue"]
        .map(label => ({label,checked:label === "In Processing Tissue",confidence:.99})),
      tissues:[{item:"R&L Patellar",rowId:"tissue-1",graftId:"N/A",graftIdKind:"na",confirmed:true,confirmationConfidence:.99}],
      bottomFields:[
        ["Tissue Discarded By","MC"],["Confirmed By","AM"],["Discard Date","09-03-24"],
        ["FreezerPro Updated By","N/A"],["FreezerPro Updated Date","N/A"],
        ["Log / FreezerPro Updated By","AM"],["Log / FreezerPro Updated Date","01/20/25"]
      ].map(([label,value]) => ({label,...field(value)}))
    }
  }]
};
