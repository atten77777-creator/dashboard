
const response = `Next, the SQL query to get the count of successful vs. unsuccessful logins, which can be used for both a column chart and a pie chart. 
 <sql start> 
 SELECT 
     USER_NAME, 
     COUNT(LOGIN_HISTORY_ID) AS LOGIN_COUNT 
 FROM 
     ADM_LOGIN_HISTORY 
 GROUP BY 
     USER_NAME 
 ORDER BY 
     LOGIN_COUNT DESC 
 FETCH FIRST 10 ROWS ONLY; 
 <sql end> 
 <chart>Bar</chart> 
 <xaxis>USER_NAME</xaxis> 
 <yaxis>LOGIN_COUNT</yaxis> 
 <text> 
 Here is the SQL query for a column chart and a pie chart, showing the distribution of successful vs. unsuccessful logins. 
 </text> 
 <sql start> 
 SELECT 
     CASE 
         WHEN IS_SUCCESS = 1 THEN 'Successful' 
         ELSE 'Failed' 
     END AS LOGIN_STATUS, 
     COUNT(LOGIN_HISTORY_ID) AS STATUS_COUNT 
 FROM 
     ADM_LOGIN_HISTORY 
 GROUP BY 
     IS_SUCCESS; 
 <sql end> 
 <chart>Column</chart> 
 <xaxis>LOGIN_STATUS</xaxis> 
 <yaxis>STATUS_COUNT</yaxis> 
 <chart>Pie</chart> 
 <xaxis>LOGIN_STATUS</xaxis> 
 <yaxis>STATUS_COUNT</yaxis>`;

const stripCodeFences = (s) => {
    return s.replace(/```sql/gi, '').replace(/```/g, '').replace(/~~~sql/gi, '').replace(/~~~/g, '');
};

const stripLeadingLabels = (s) => {
    return s; // Simplified for test
};

const normalizeSQL = (sql) => {
    let s = String(sql || '');
    s = stripCodeFences(s);
    s = s.replace(/^SQL\s*:\s*/i, '');
    s = stripLeadingLabels(s);
    return s.trim();
};

const canonicalizeSQL = (sql) => {
    let s = String(sql || '');
    s = stripCodeFences(s);
    s = s.replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|\s)--[^\n]*(\r?\n)?/g, '$1');
    s = s.replace(/\s+/g, ' ').trim();
    s = s.replace(/;\s*$/, '');
    return s;
};

const extractAllSQL = (response, sqlFromServer) => {
    const out = [];
    const seen = new Set();
    const push = (q) => {
      const n = normalizeSQL(String(q || '')).trim();
      const key = canonicalizeSQL(n);
      if (n && key && !seen.has(key)) { seen.add(key); out.push(n); }
    };
    const text = String(response || '');
    const re = /<sql\s*start>([\s\S]*?)<\/?sql\s*end>/gi;
    const matches = Array.from(text.matchAll(re));
    console.log(`Found ${matches.length} matches`);
    for (const m of matches) { 
        console.log('Match content:', m[1]);
        push(m[1] || ''); 
    }
    if (typeof sqlFromServer === 'string' && sqlFromServer.trim()) { push(sqlFromServer); }
    return out;
  };

const extracted = extractAllSQL(response);
console.log('Extracted SQLs:', extracted);
console.log('Count:', extracted.length);
