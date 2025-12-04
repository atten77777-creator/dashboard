const oracledb = require('oracledb');

// Oracle configuration (same as server)
const ORACLE_CONFIG = {
  user: process.env.ORACLE_USER || 'SMARTERP',
  password: process.env.ORACLE_PASS || 'erp',
  connectString: process.env.ORACLE_DSN || 'localhost:1521/mabl',
  libDir: process.env.ORACLE_HOME || 'D:\\app\\BC\\product\\11.2.0\\dbhome_1\\BIN'
};

async function testSchema() {
  console.log('🔍 Testing Oracle Database Schema Visibility');
  console.log('Configuration:', ORACLE_CONFIG);
  console.log('---');
  
  try {
    // Set Oracle client location
    if (ORACLE_CONFIG.libDir) {
      oracledb.initOracleClient({ libDir: ORACLE_CONFIG.libDir });
    }
    
    // Create connection
    const connection = await oracledb.getConnection(ORACLE_CONFIG);
    console.log('✅ Database connection established successfully');
    
    // 1. Test the specific ADM_LOGIN_HISTORY table query
    console.log('\n1. Checking ADM_LOGIN_HISTORY table schema...');
    const schemaSql = `
      SELECT owner, table_name, column_name, data_type, data_length 
      FROM all_tab_columns 
      WHERE table_name = 'ADM_LOGIN_HISTORY' 
      ORDER BY column_id
    `;
    
    const schemaResult = await connection.execute(schemaSql, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
    
    if (schemaResult.rows && schemaResult.rows.length > 0) {
      console.log('✅ ADM_LOGIN_HISTORY table found with columns:');
      schemaResult.rows.forEach((row, index) => {
        console.log(`   ${index + 1}. ${row.OWNER}.${row.TABLE_NAME}.${row.COLUMN_NAME} (${row.DATA_TYPE}, ${row.DATA_LENGTH})`);
      });
    } else {
      console.log('❌ ADM_LOGIN_HISTORY table not found or has no columns');
      
      // 2. Check if table exists with different case
      console.log('\n2. Checking for table with different case...');
      const caseSql = `SELECT table_name FROM user_tables WHERE UPPER(table_name) = 'ADM_LOGIN_HISTORY'`;
      const caseResult = await connection.execute(caseSql, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
      
      if (caseResult.rows && caseResult.rows.length > 0) {
        console.log('💡 Table exists with different case:', caseResult.rows[0].TABLE_NAME);
      } else {
        console.log('💡 Table not found with any case variation');
      }
    }
    
    // 3. Check user permissions and available tables
    console.log('\n3. Checking user permissions and available tables...');
    const tablesSql = `SELECT table_name, num_rows FROM user_tables ORDER BY table_name`;
    const tablesResult = await connection.execute(tablesSql, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
    
    console.log(`📊 User has access to ${tablesResult.rows?.length || 0} tables:`);
    if (tablesResult.rows && tablesResult.rows.length > 0) {
      tablesResult.rows.slice(0, 10).forEach(row => {
        console.log(`   - ${row.TABLE_NAME} (${row.NUM_ROWS || 0} rows)`);
      });
      if (tablesResult.rows.length > 10) {
        console.log(`   ... and ${tablesResult.rows.length - 10} more tables`);
      }
    }
    
    // 4. Check if user has access to all_tab_columns (should have if DBA privileges)
    console.log('\n4. Checking system view access...');
    try {
      const sysSql = `SELECT COUNT(*) as count FROM all_tab_columns WHERE ROWNUM <= 1`;
      const sysResult = await connection.execute(sysSql, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
      console.log('✅ User has access to system views (all_tab_columns)');
    } catch (sysError) {
      console.log('❌ User lacks privileges to access system views (all_tab_columns)');
      console.log('💡 Try using user_tab_columns instead for user-owned tables');
    }
    
    await connection.close();
    
  } catch (error) {
    console.error('❌ Database error:', error.message);
    
    if (error.code === 'NJS-500') {
      console.log('💡 Oracle client library not found. Check ORACLE_HOME environment variable.');
      console.log('💡 Current ORACLE_HOME:', ORACLE_CONFIG.libDir);
    } else if (error.code === 'ORA-01017') {
      console.log('💡 Invalid username/password. Check ORACLE_USER and ORACLE_PASS environment variables.');
    } else if (error.code === 'ORA-12154') {
      console.log('💡 Invalid connection string. Check ORACLE_DSN environment variable.');
    } else if (error.code === 'ORA-00942') {
      console.log('💡 Table or view does not exist. The user may not have access to this table.');
    }
  }
}

testSchema();