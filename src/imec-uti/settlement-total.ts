// Accept Brazilian currency grouping and either comma or dot decimal input.
export function parseSettlementTotal(value:string):number|null{
 const raw=value.trim();
 if(!/^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$/.test(raw)&&!/^\d+\.\d{1,2}$/.test(raw))return null;
 const normalized=raw.includes(',')?raw.replace(/\./g,'').replace(',','.'):/^\d{1,3}(?:\.\d{3})+$/.test(raw)?raw.replace(/\./g,''):raw;
 const number=Number(normalized);return Number.isFinite(number)&&number>=0&&number<=1000000?Math.round(number*100)/100:null;
}
