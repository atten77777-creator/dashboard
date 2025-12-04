
const rawInput = `Next, the SQL query to get the count of successful vs. unsuccessful logins, which can be used for both a column chart and a pie chart. 
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

function normalizeSQL(sql) {
    if (!sql) return '';
    return sql.replace(/```sql/gi, '').replace(/```/g, '').replace(/^SQL:\s*/i, '').trim();
}

function canonicalizeSQL(sql) {
    if (!sql) return '';
    return sql.replace(/--.*$/gm, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function extractAllSQL(text, fallback) {
    if (!text) return fallback ? [fallback] : [];
    const re = /<sql\s*start>([\s\S]*?)<\/?sql\s*end>/gi;
    const matches = [];
    let m;
    while ((m = re.exec(text)) !== null) {
        if (m[1] && m[1].trim()) {
            matches.push(m[1].trim());
        }
    }
    if (matches.length === 0 && fallback) return [fallback];
    return matches;
}

function extractMultiChartTags(raw) {
    const s = String(raw || '');
    const blocks = [];
    const re = /<sql\s*start>([\s\S]*?)<\/?sql\s*end>/gi;
    let m;
    while ((m = re.exec(s)) !== null) {
        blocks.push({ start: m.index, end: re.lastIndex });
    }
    if (!blocks.length) return [];

    // Mocking parseSegmentTags as seen in ChatSidebar.tsx
    const parseSegmentTags = (seg, pickLast = false) => {
        const text = String(seg || '');
        const grab = (name) => {
            const re = new RegExp(`<${name}>([\\s\\S]*?)<\\/${name}>`, 'gi');
            const vals = [];
            let m;
            while ((m = re.exec(text)) !== null) {
                vals.push(m[1].trim());
            }
            return vals;
        };
        
        const types = grab('chart');
        const xs = grab('xaxis');
        const ys = grab('yaxis');
        
        // In the real code, it does: const v = grab(nm)[0]; 
        // which effectively ignores subsequent matches.
        
        if (types.length === 0 && xs.length === 0 && ys.length === 0) return null;
        
        return { 
            type: types[0], 
            x: xs[0], 
            y: ys.length ? ys : undefined,
            // Debug info
            allTypes: types
        };
    };

    const out = [];
    for (let i = 0; i < blocks.length; i++) {
        const afterFrom = blocks[i].end;
        const afterTo = i < blocks.length - 1 ? blocks[i + 1].start : s.length;
        const afterSeg = s.slice(afterFrom, afterTo);
        let tags = parseSegmentTags(afterSeg, false);
        
        if (!tags) {
             const beforeFrom = i > 0 ? blocks[i - 1].end : 0;
             const beforeTo = blocks[i].start;
             const beforeSeg = s.slice(beforeFrom, beforeTo);
             tags = parseSegmentTags(beforeSeg, true);
        }
        out.push(tags || null);
    }
    return out;
}

// Simulation
const displayResponse = rawInput;
const extractedClient = extractAllSQL(displayResponse);
const queries = extractedClient.map(q => normalizeSQL(q));

console.log('Extracted Queries Count:', queries.length);
queries.forEach((q, i) => {
    console.log(`Query ${i + 1}:`, q.substring(0, 50) + '...');
});

const multiChartTags = extractMultiChartTags(displayResponse);
console.log('Multi Chart Tags:', JSON.stringify(multiChartTags, null, 2));
