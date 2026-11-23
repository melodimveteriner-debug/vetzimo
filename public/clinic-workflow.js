const auditedTypes=["clients","patients","appointments","stays","products","stockMoves","stockLots"];
const reviewTypes=new Set(["appointments","stays","products","stockLots"]);
const hour=3600000;

export function followupKey(type,row) {
  if(type==="criticalStock") return row.min!=="" && row.min!=null && Number(row.stock)<=Number(row.min)?row.stock+":"+row.min:"";
  if(type==="appointments") return row.date && row.time ? row.date+"T"+row.time : "";
  if(type==="stays") return row.end||"";
  return row.expiry||(type==="products"?"stock":"");
}

export function stampClinicActions(before,after,author,now) {
  for(const type of auditedTypes) {
    const previous=new Map((before?.[type]||[]).map(row=>[row.id,row]));
    for(const row of after[type]||[]) {
      const old=previous.get(row.id);
      if(old?.createdBy) row.createdBy=old.createdBy;
      else if(!old) row.createdBy=author;
      else delete row.createdBy;
      if(!reviewTypes.has(type)) continue;
      stampReview(type,row,old,author,now);
      if(type==="products") stampReview("criticalStock",row,old,author,now,"critical");
    }
  }
}

function stampReview(type,row,old,author,now,prefix="") {
  const field=key=>prefix?prefix+key[0].toUpperCase()+key.slice(1):key;
  const key=followupKey(type,row);
  const requested=row[field("reviewToken")];
  if(key && /^[a-f0-9-]{36}$/i.test(requested||"") && requested!==old?.[field("reviewToken")]) {
    row[field("reviewToken")]=requested;
    row[field("reviewedFor")]=key;
    row[field("reviewedBy")]=author;
    row[field("reviewedAt")]=now;
  } else {
    for(const base of ["reviewToken","reviewedFor","reviewedBy","reviewedAt"]) {
      const name=field(base);
      if(old?.[name] && (type!=="criticalStock" || key)) row[name]=old[name];
      else delete row[name];
    }
  }
}

export function dueWithinDay(timestamp,now=Date.now()) {
  const due=Date.parse(timestamp+"+03:00");
  return due>=now && due<=now+24*hour;
}

export function reviewedName(type,row) {
  if (!row) return "";
  if(type==="criticalStock") return row.criticalReviewedFor===followupKey(type,row)?row.criticalReviewedBy||"":"";
  return row.reviewedFor===followupKey(type,row)?row.reviewedBy||"":"";
}
