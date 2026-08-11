const mysql = require('mysql2/promise');

// ========= 改成你Aiven数据库配置 =========
const dbConfig = {
  host: "mysql-f48f62d-w1e2b3.b.aivencloud.com",
  port: 15922,
  user: "avnadmin",
  password: "AVNS_1gK2TxekSjdCodoBaO3",
  database: "defaultdb",
  ssl: { rejectUnauthorized: false }
};
// ========================================

(async () => {
  let conn;
  try {
    conn = await mysql.createConnection(dbConfig);
    const dbName = dbConfig.database;

    console.log("===== 数据库:" + dbName + " 空间统计 =====\n");

    // 1.每张表大小
    const [tables] = await conn.query(`
SELECT
  TABLE_NAME AS table_name,
  ROUND(((DATA_LENGTH + INDEX_LENGTH)/1024/1024),3) AS mb
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = ?
ORDER BY mb DESC
    `,[dbName]);

    console.log("【各表占用】");
    for(const t of tables){
      console.log(`表 ${t.table_name.padEnd(15)} ${t.mb} MB`);
    }

    //2.数据库总大小
    const [total] = await conn.query(`
SELECT ROUND(SUM((DATA_LENGTH + INDEX_LENGTH)/1024/1024),3) AS total_mb
FROM information_schema.TABLES
WHERE TABLE_SCHEMA=?
    `,[dbName]);

    console.log("\n【数据库总占用】：", total[0].total_mb, " MB");

  } catch (err) {
    console.error("查询失败：",err.message);
  } finally {
    if(conn) await conn.end();
  }
})();