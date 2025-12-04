// POST the SQL to the /api/query/preview endpoint to inspect parsing/execution
const url = 'http://localhost:3001/api/query/preview';

const sql = `SELECT 
  TO_CHAR(ACTIVITY_TIME, 'YYYY-MM-DD HH24') AS LOGON_HOUR,
  COUNT(*) AS SUCCESSFUL_LOGIN_COUNT
FROM ADM_LOGIN_HISTORY
WHERE IS_SUCCESS = 1
GROUP BY TO_CHAR(ACTIVITY_TIME, 'YYYY-MM-DD HH24')
ORDER BY LOGON_HOUR`;

async function main() {
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql })
    });
    const text = await resp.text();
    console.log('Status:', resp.status);
    try {
      const json = JSON.parse(text);
      console.log('Response JSON:', JSON.stringify(json, null, 2));
    } catch {
      console.log('Response Text:', text);
    }
  } catch (e) {
    console.error('Request failed:', e);
  }
}

main();