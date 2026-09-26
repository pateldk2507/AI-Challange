export const extractionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["formType", "classificationConfidence", "pages", "warnings"],
  properties: {
    formType: {
      type: "string",
      enum: ["MP-F-023", "QS-F-049", "LOT_LOG", "DISCARD_FORM", "UNKNOWN"]
    },
    classificationConfidence: { type: "number" },
    warnings: { type: "array", items: { type: "string" } },
    pages: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "page", "topFields", "operationsManagerReview", "productRows",
          "reviewRows", "item10", "lotItems", "regenMedItems",
          "sterilizationItems", "packagingItems", "discard"
        ],
        properties: {
          page: { type: "integer" },
          topFields: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["label", "value", "initials", "date", "kind", "confidence", "hasVisibleMark"],
              properties: {
                label: { type: "string" },
                value: { type: "string" },
                initials: { type: "string" },
                date: { type: "string" },
                kind: { type: "string", enum: ["value", "by_date"] },
                confidence: { type: "number" },
                hasVisibleMark: { type: "boolean" }
              }
            }
          },
          operationsManagerReview: {
            type: "object",
            additionalProperties: false,
            required: ["present", "initials", "date", "confidence", "hasVisibleMark"],
            properties: {
              present: { type: "boolean" },
              initials: { type: "string" },
              date: { type: "string" },
              confidence: { type: "number" },
              hasVisibleMark: { type: "boolean" }
            }
          },
          productRows: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["item", "produced", "packaged", "producedApplicable", "packagedApplicable", "confidence"],
              properties: {
                item: { type: "string" },
                produced: { type: "string" },
                packaged: { type: "string" },
                producedApplicable: { type: "boolean" },
                packagedApplicable: { type: "boolean" },
                confidence: { type: "number" }
              }
            }
          },
          reviewRows: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["item", "technical", "quality"],
              properties: {
                item: { type: "string" },
                technical: { "$ref": "#/$defs/reviewCell" },
                quality: { "$ref": "#/$defs/reviewCell" }
              }
            }
          },
          item10: {
            type: "object",
            additionalProperties: false,
            required: ["incNumber", "status", "confidence"],
            properties: {
              incNumber: { type: "string" },
              status: { type: "string" },
              confidence: { type: "number" }
            }
          },
          lotItems: { "$ref": "#/$defs/lotItemArray" },
          regenMedItems: { "$ref": "#/$defs/lotQtyArray" },
          sterilizationItems: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["item", "loadNumber", "sterilizationDate", "confidence"],
              properties: {
                item: { type: "string" },
                loadNumber: { type: "string" },
                sterilizationDate: { type: "string" },
                confidence: { type: "number" }
              }
            }
          },
          packagingItems: { "$ref": "#/$defs/lotQtyArray" },
          discard: { anyOf: [{ "$ref": "#/$defs/discardForm" }, { type:"null" }] }
        }
      }
    }
  },
  "$defs": {
    discardField: {
      type:"object", additionalProperties:false,
      required:["value","confidence","hasVisibleMark"],
      properties:{value:{type:"string"},confidence:{type:"number"},hasVisibleMark:{type:"boolean"}}
    },
    discardForm: {
      type:"object", additionalProperties:false,
      required:["layoutDetected","tissuesDetected","donorNumber","reason","authorization","tissueStatuses","tissues","bottomFields"],
      properties:{
        layoutDetected:{type:"boolean"}, tissuesDetected:{type:"boolean"},
        donorNumber:{"$ref":"#/$defs/discardField"}, reason:{"$ref":"#/$defs/discardField"},
        authorization:{
          type:"object", additionalProperties:false, required:["initials","date"],
          properties:{initials:{"$ref":"#/$defs/discardField"},date:{"$ref":"#/$defs/discardField"}}
        },
        tissueStatuses:{
          type:"array", items:{
            type:"object", additionalProperties:false, required:["label","checked","confidence"],
            properties:{label:{type:"string",enum:["Unprocessed Tissue","In Processing Tissue","Unreleased Packaged Tissue","Released Packaged Tissue"]},checked:{type:"boolean"},confidence:{type:"number"}}
          }
        },
        tissues:{
          type:"array", items:{
            type:"object", additionalProperties:false,
            required:["item","itemImage","rowId","location","graftId","graftIdKind","confirmed","confirmationConfidence"],
            properties:{
              item:{type:"string"},itemImage:{type:"string"},rowId:{type:"string"},location:{type:"string"},
              graftId:{type:"string"},graftIdKind:{type:"string",enum:["id","na","dash","blank","unknown"]},
              confirmed:{type:"boolean"},confirmationConfidence:{type:"number"}
            }
          }
        },
        bottomFields:{
          type:"array",items:{
            type:"object",additionalProperties:false,required:["label","value","confidence","hasVisibleMark"],
            properties:{label:{type:"string"},value:{type:"string"},confidence:{type:"number"},hasVisibleMark:{type:"boolean"}}
          }
        }
      }
    },
    reviewCell: {
      type: "object",
      additionalProperties: false,
      required: ["raw", "initials", "date", "isNA", "confidence", "hasVisibleMark"],
      properties: {
        raw: { type: "string" },
        initials: { type: "string" },
        date: { type: "string" },
        isNA: { type: "boolean" },
        confidence: { type: "number" },
        hasVisibleMark: { type: "boolean" }
      }
    },
    lotItemArray: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["item", "lotNumber", "expirationDate", "manufacturer", "confidence"],
        properties: {
          item: { type: "string" },
          lotNumber: { type: "string" },
          expirationDate: { type: "string" },
          manufacturer: { type: "string" },
          confidence: { type: "number" }
        }
      }
    },
    lotQtyArray: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["item", "lot", "qtyUsed", "confidence"],
        properties: {
          item: { type: "string" },
          lot: { type: "string" },
          qtyUsed: { type: "string" },
          confidence: { type: "number" }
        }
      }
    }
  }
};
