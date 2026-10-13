export function parseCSV(text){
 text=text.replace(/^\uFEFF/,'');const rows=[];let row=[],field='',quoted=false;
 for(let i=0;i<text.length;i++){const ch=text[i];if(ch==='"'){if(quoted&&text[i+1]==='"'){field+='"';i++;}else if(quoted){quoted=false;}else if(!field){quoted=true;}else throw new Error('Unexpected quote in CSV');}
 else if(ch===','&&!quoted){row.push(field);field='';}else if((ch==='\n'||ch==='\r')&&!quoted){if(ch==='\r'&&text[i+1]==='\n')i++;row.push(field);if(row.some(v=>v.trim()))rows.push(row);row=[];field='';}else field+=ch;}
 if(quoted)throw new Error('CSV has an unclosed quote');row.push(field);if(row.some(v=>v.trim()))rows.push(row);
 if(rows.length<2)throw new Error('Include a header row and at least one lead');if(rows.length>2001)throw new Error('Upload at most 2,000 leads per file');
 const headers=rows.shift().map((s,i)=>s.trim()||'Column '+(i+1));
 if(rows.some(r=>r.length>headers.length))throw new Error('A row has more values than the header. Check CSV quoting.');return {headers,rows};
}
export function detect(headers){const key=s=>s.toLowerCase().replace(/[^a-z0-9]/g,'');const names={email:['email','emailaddress','emailcolumn'],first_name:['firstname','first'],last_name:['lastname','last','surname'],organization:['organization','company','school','schoolname']};return Object.fromEntries(Object.entries(names).map(([k,values])=>[k,headers.findIndex(h=>values.includes(key(h)))]));}
export function mapRows(csv,mapping){return csv.rows.map(row=>Object.fromEntries(Object.entries(mapping).map(([k,i])=>[k,i<0?'':row[i]||''])));}
export function exportCSV(rows,fields){const cell=v=>{let text=String(v??'');if(/^\s*[=+\-@]/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';};return [fields.map(cell).join(','),...rows.map(row=>fields.map(k=>cell(row[k])).join(','))].join('\r\n');}
