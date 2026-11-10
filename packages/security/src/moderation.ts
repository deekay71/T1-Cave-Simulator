// Small reviewable baseline, not a complete Vietnamese moderation model.
const reserved=new Set(['admin','administrator','moderator','staff','faker','oner','gumayusi','keria','doran']);
const accentWords=['địt','đụ','đéo'];
const plainWords=['dit','du','deo','dm','dmm','dcm','vcl','fuck','shit'];
const unaccent=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d');
export function normalize(text:string){return text.normalize('NFC').toLowerCase().replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g,'').replace(/(.)\1{2,}/gu,'$1$1');}
export function moderate(raw:string,kind:'name'|'chat'):{ok:boolean;reason?:string}{
 const s=normalize(raw);const plain=unaccent(s);
 if(kind==='name'&&reserved.has(plain.replace(/[^a-z]/g,'')))return {ok:false,reason:'Tên dành riêng'};
 if(/(?:https?:|www\s*\.|discord\s*\.\s*gg|[a-z0-9-]+\s*(?:\.|\[dot\])\s*(?:com|net|org|vn|io|gg)\b)/iu.test(s))return {ok:false,reason:'Không gửi đường dẫn trong chat'};
 if(/(?:\+?\d[\s().-]*){9,}/u.test(s))return {ok:false,reason:'Không gửi số điện thoại'};
 const tokens=s.replace(/[013457@]/g,c=>({'0':'o','1':'i','3':'e','4':'a','5':'s','7':'t','@':'a'}[c]!)).match(/[\p{L}]+/gu)||[];
 if(tokens.some(t=>accentWords.includes(t)))return {ok:false,reason:'Nội dung không phù hợp'};
 if(s===plain&&tokens.some(t=>plainWords.includes(t)))return {ok:false,reason:'Nội dung không phù hợp'};
 // Catch common letter-separated obfuscation without stripping whole Vietnamese sentences.
 const compact=plain.replace(/[^a-z]/g,'');
 if(['dcm','dmm','vcl','fuck'].includes(compact))return {ok:false,reason:'Nội dung không phù hợp'};
 return {ok:true};
}
