const express = require ('express');
const mysql = require ('mysql2/promise');
const bodyParser = require ('body-parser');
const cors = require ('cors');
const path = require ('path');
const crypto = require ('crypto');
const nodemailer = require ('nodemailer');
const multer = require ('multer');
const fs = require ('fs');
const session = require ('express-session');
// 引入 socket.io
const { Server } = require ("socket.io");
const http = require ("http");
const app = express ();
// 创建 http 服务器，socket.io 挂载上去
const server = http.createServer (app);
const io = new Server (server, {
cors: { origin: "*" }
});
// ============ session 必须放在路由最前面！！ ============
app.use (session ({
secret: "admin_secret_2026",
resave: false,
saveUninitialized: false,
cookie:{maxAge:1000*60*60*2}
}));
// 【修复】静态资源、解析器前置
app.use (express.static ('./public'));
app.use (cors ());
app.use (bodyParser.json ());
app.use (express.json ());
// ============ multer 文件上传配置【适配OpenShift容器】 ============
const UPLOAD_DIR = "/tmp/upload";
if (!fs.existsSync (UPLOAD_DIR)) {
fs.mkdirSync (UPLOAD_DIR, { recursive: true });
}
app.use ('/upload', express.static (UPLOAD_DIR));
const storage = multer.diskStorage({
destination: function (req, file, cb) {
cb(null, UPLOAD_DIR);
},
filename: function (req, file, cb) {
const ext = path.extname(file.originalname);
const filename = Date.now() + "_" + Math.random().toString(36).slice(2) + ext;
cb(null, filename);
}
});
const upload = multer({ storage: storage });
// ============ Aiven MySQL 配置 ============
const pool = mysql.createPool ({
host:"mysql-f48f62d-w1e2b3.b.aivencloud.com",
port:15922,
user:"avnadmin",
password:"AVNS_1gK2TxekSjdCodoBaO3",
database:"defaultdb",
ssl:{rejectUnauthorized:false}
});
//mysql 连接错误监听
pool.on ('error', (err)=>{
console.error ("MySQL 数据库连接异常：",err);
})
// 创建数据表
async function initTable (){
const conn = await pool.getConnection ();
await conn.execute (`CREATE TABLE IF NOT EXISTS users( id INT AUTO_INCREMENT PRIMARY KEY, username VARCHAR(100) UNIQUE NOT NULL, email VARCHAR(150) UNIQUE NOT NULL, password VARCHAR(200) NOT NULL, verify_code VARCHAR(20), code_expire DATETIME )`);
await conn.execute(`CREATE TABLE IF NOT EXISTS posts( id INT AUTO_INCREMENT PRIMARY KEY, username VARCHAR(100) NOT NULL, title VARCHAR(200) NOT NULL, content TEXT NOT NULL, create_time DATETIME DEFAULT CURRENT_TIMESTAMP, img_url VARCHAR(500), audio_url VARCHAR(500) )`);
await conn.execute(`CREATE TABLE IF NOT EXISTS replies ( id INT AUTO_INCREMENT PRIMARY KEY, post_id INT NOT NULL, username VARCHAR(100) NOT NULL, content TEXT NOT NULL, create_time DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(post_id) REFERENCES posts(id) ON DELETE CASCADE )`);
conn.release ();
}
initTable ().catch (e=>console.error ("表初始化失败",e));
// ============【新增：后端服务器时间接口】============
app.get ("/api/server-time", (req, res) => {
const now = new Date ();
res.json ({
timestamp: now.getTime (),
iso: now.toISOString (),
localStr: now.toLocaleString ("zh-CN")
});
});
// ============ 邮箱发送配置【完全保留你原来的配置，不作修改】============
const transporter = nodemailer.createTransport ({
host: "smtp.qq.com",
port: 465,
secure: true,
auth: {
user: "2453074375@qq.com",
pass: "rtdzqsgiesoyebgg"
}
});
// 生成验证码
function makeCode (){
return String (Math.floor (100000+Math.random ()*900000));
}
// 发送邮箱验证码接口【原样保留】
app.post ('/send-code',async (req,res)=>{
try {
let {email} = req.body;
email = email.toLowerCase ();
const code = makeCode ();
const expire = new Date (Date.now () + 10*60*1000);
const [r] = await pool.execute(`SELECT id,username FROM users WHERE email=?`,[email]);
// 如果该邮箱已经完整注册（username 不为空），禁止再次获取注册验证码
if (r.length>0 && r [0].username){
return res.json ({ok:false,msg:"该邮箱已注册账号，请直接登录"});
}
if (r.length === 0){
await pool.execute (`INSERT INTO users(email,verify_code,code_expire) VALUES (?,?,?)`,[email,code,expire])
}else{
await pool.execute(`UPDATE users SET verify_code=?,code_expire=? WHERE email=?`,[code,expire,email])
}
await transporter.sendMail ({
from: '"三角洲论坛" <2453074375@qq.com>',
to: email,
subject: "三角洲行动论坛注册验证码",
html: `
<html lang="zh-CN"> <head> <meta charset="UTF-8"> <meta name="viewport" content="width=device-width, initial-scale=1.0"> <title>注册验证码</title> <style> body { font-family: "Microsoft YaHei", Arial, sans-serif; background-color:#f5f7fa; padding:30px; } .container{ max-width:520px; background:#ffffff; margin:0 auto; padding:32px; border-radius:12px; border:1px solid #e5e7eb; } .title{ font-size:22px; color:#1f2937; text-align:center; margin-bottom:24px; } .code{ font-size:38px; font-weight:bold; letter-spacing:12px; color:#1677ff; text-align:center; padding:20px 0; background:#f0f7ff; border-radius:8px; } .desc{ margin-top:20px; font-size:14px; color:#4b5563; line-height:1.8; } .footer{ margin-top:30px; font-size:12px; color:#9ca3af; text-align:center; } </style> </head> <body> <div class="container"> <div class="title">🔐 注册验证码</div> <div class="code">${code}</div> <div class="desc"> 您好，您正在注册三角洲行动论坛账号。<br> 验证码有效期：10分钟，请尽快完成注册。<br> 如果不是您本人操作，请忽略此邮件。 </div> <div class="footer">三角洲行动论坛 ©2026</div> </div> </body> </html> ` })
res.json({ok:true})
}catch(e){
console.error(e);
res.json({ok:false,msg:e.message})
}
})
//==================== 找回密码接口开始【原样保留】 ====================
app.post('/send-reset-code',async (req,res)=>{
try{
let {email} = req.body;
email = email.toLowerCase();
const [userCheck] = await pool.execute(`SELECT id FROM users WHERE email=?`,[email]);
if (userCheck.length === 0){
return res.json ({ok:false,msg:"该邮箱没有注册账号"});
}
const code = makeCode ();
const expire = new Date (Date.now () + 10*60*1000);
await pool.execute(`UPDATE users SET verify_code=?,code_expire=? WHERE email=?`,[code,expire,email]);
await transporter.sendMail ({
from: '"三角洲论坛" <2453074375@qq.com>',
to: email,
subject:"三角洲行动论坛账号密码找回",
html:`
<html lang="zh-CN"> <head> <meta charset="UTF-8"> <meta name="viewport" content="width=device-width, initial-scale=1.0"> <title>密码找回验证码</title> <style> body { font-family: "Microsoft YaHei", Arial, sans-serif; background-color:#f5f7fa; padding:30px; } .container{ max-width:520px; background:#ffffff; margin:0 auto; padding:32px; border-radius:12px; border:1px solid #e5e7eb; } .title{ font-size:22px; color:#1f2937; text-align:center; margin-bottom:24px; } .code{ font-size:38px; font-weight:bold; letter-spacing:12px; color:#1677ff; text-align:center; padding:20px 0; background:#f0f7ff; border-radius:8px; } .desc{ margin-top:20px; font-size:14px; color:#4b5563; line-height:1.8; } .footer{ margin-top:30px; font-size:12px; color:#9ca3af; text-align:center; } </style> </head> <body> <div class="container"> <div class="title">🔐 密码找回验证码</div> <div class="code">${code}</div> <div class="desc"> 您好，您正在找回三角洲行动论坛账号密码。<br> 验证码有效期：10分钟，请尽快完成注册。<br> 如果不是您本人操作，请忽略此邮件。 </div> <div class="footer">三角洲行动论坛 ©2026</div> </div> </body> </html> ` })
return res.json({ok:true});
}catch(err){
console.error("send‑reset‑code error",err);
return res.json({ok:false,msg:err.message});
}
});

app.post ('/reset-password',async (req,res)=>{
try {
let {email,code,newPassword} = req.body;
email = email.toLowerCase ();
const now = new Date ();
const [rows] = await pool.execute (`SELECT * FROM users WHERE email=?`,[email]);
if (rows.length===0) return res.json ({ok:false,msg:"邮箱不存在"});
const user = rows [0];
if (user.verify_code !== code) return res.json ({ok:false,msg:"验证码错误"});
if (new Date (user.code_expire) < now) return res.json ({ok:false,msg:"验证码已过期"});
const hashPwd = crypto.createHash ('md5').update (newPassword).digest ('hex');
await pool.execute (`UPDATE users SET password=?,verify_code=null,code_expire=null WHERE email=?`,[hashPwd,email]);
return res.json ({ok:true});
} catch (err){
console.error ("reset‑password error",err);
return res.json ({ok:false,msg:err.message});
}
});
//==================== 找回密码接口结束 ====================
// 邮箱注册
app.post ('/register-email',async (req,res)=>{
try {
let {email,code,username,password} = req.body;
email = email.toLowerCase ();
const now = new Date ();
// 检查邮箱是否已经完整注册
const [checkUser] = await pool.execute (`SELECT * FROM users WHERE email=?`,[email]);
if (checkUser.length>0 && checkUser [0].username){
return res.json ({ok:false,msg:"该邮箱已经注册账号，请直接登录"});
}
if (checkUser.length===0) return res.json ({ok:false,msg:"请先获取验证码"});
const u = checkUser [0];
if (u.verify_code!==code) return res.json ({ok:false,msg:"验证码错误"});
if (new Date (u.code_expire)<now) return res.json ({ok:false,msg:"验证码过期"});
const hashPwd = crypto.createHash ('md5').update (password).digest ('hex');
await pool.execute (`UPDATE users SET username=?,password=?,verify_code=null,code_expire=null WHERE email=?`,[username,hashPwd,email]);
res.json({ok:true});
} catch (e){
// 捕获唯一索引冲突，防止并发重复注册
if (e.code === 'ER_DUP_ENTRY'){
return res.json ({ok:false,msg:"该邮箱已经注册账号，请直接登录"});
}
res.json ({ok:false,msg:e.message})
}
})
// 登录
app.post ('/login',async (req,res)=>{
try {
let {email,password}=req.body;
email = email.toLowerCase ();
const md5pwd = crypto.createHash ('md5').update (password).digest ('hex');
const [r] = await pool.execute (`SELECT id,username FROM users WHERE email=? AND password=?`,[email,md5pwd]);
if (r.length>0){
if (!r [0].username){
return res.json ({ok:false,msg:"账号未完成注册，请重新注册"});
}
res.json ({ok:true,user:r [0]})
} else {
res.json ({ok:false,msg:"账号密码错误"})
}
} catch (e){
res.json ({ok:false,msg:e.message})
}
})
// 文件上传接口
app.post ('/upload-file', upload.fields ([{name:'img'},{name:'audio'}]), (req,res)=>{
let imgPath = "";
let audioPath = "";
if (req.files.img){
imgPath = "/upload/" + req.files.img [0].filename;
}
if (req.files.audio){
audioPath = "/upload/" + req.files.audio [0].filename;
}
res.json ({ok:true,imgUrl:imgPath,audioUrl:audioPath});
})
// 发布帖子，新增 io 广播事件
app.post ('/post-add',async (req,res)=>{
try {
const {username,title,content,img_url,audio_url}=req.body;
await pool.execute (`INSERT INTO posts(username,title,content,img_url,audio_url) VALUES(?,?,?,?,?)`,[username,title,content,img_url||"",audio_url||""]);
// 广播通知全部客户端：有新帖子
io.emit ("new_post");
res.json ({ok:true})
} catch (e){
res.json ({ok:false,msg:e.message})
}
})
// 获取全部帖子
app.get ('/post-list',async (req,res)=>{
const [list] = await pool.execute (`SELECT * FROM posts ORDER BY create_time DESC`);
res.json(list);
})
// 提交评论【修复字段 post_id】，新增 io 广播
app.post ('/comment-add',async (req,res)=>{
try {
const {post_id,username,content}=req.body;
await pool.execute (`INSERT INTO replies(post_id,username,content) VALUES(?,?,?)`,[post_id,username,content]);
// 广播有新评论，带上帖子 id
io.emit ("new_comment",{post_id});
res.json ({ok:true})
} catch (e){
console.error (e);
res.json ({ok:false,msg:e.message})
}
})
// 获取某个帖子的全部评论
app.get ('/comment',async (req,res)=>{
const pid = req.query.postId;
const [rep] = await pool.execute (`SELECT * FROM replies WHERE post_id=? ORDER BY create_time ASC`,[pid]);
res.json(rep);
})
// 后台登录接口 账号：1 密码：1
app.post ("/api/admin/login",async (req,res)=>{
const {account,pwd} = req.body;
if (account === "1" && pwd === "1"){
req.session.isAdmin = true;
return res.json ({ok:true})
}
res.json ({ok:false,msg:"账号密码错误"})
})
// 校验是否管理员中间件
function checkAdmin (req,res,next){
if (!req.session.isAdmin){
return res.status (403).json ({ok:false,msg:"未登录后台"})
}
next ();
}
// 获取全部帖子
app.get ("/api/admin/posts",checkAdmin,async (req,res)=>{
try {
const [rows] = await pool.query ("SELECT id,username,title,content,create_time,img_url,audio_url FROM posts ORDER BY create_time DESC");
res.json ({list:rows})
} catch (e){
console.error ("admin posts error",e)
res.status (500).json ({ok:false,msg:e.message})
}
})
// 删除帖子
app.delete ("/api/admin/post/:id",checkAdmin,async (req,res)=>{
const id = req.params.id;
await pool.query ("DELETE FROM posts WHERE id=?",[id]);
io.emit ("new_post");
res.json ({ok:true})
})
// 获取全部用户【新增返回 email 邮箱】
app.get ("/api/admin/users",checkAdmin,async (req,res)=>{
try {
const [rows] = await pool.query ("SELECT id,username,email,password FROM users");
res.json ({list:rows})
} catch (e){
console.error ("admin users error",e)
res.status (500).json ({ok:false,msg:e.message})
}
})
// 修改用户密码
app.post ("/api/admin/user/password",checkAdmin,async (req,res)=>{
const {userId,newPwd} = req.body;
const hashPwd = crypto.createHash ('md5').update (newPwd).digest ('hex');
await pool.query ("UPDATE users SET password=? WHERE id=?",[hashPwd,userId]);
res.json ({ok:true})
})
// 删除用户
app.delete ("/api/admin/user/:id",checkAdmin,async (req,res)=>{
const id = req.params.id;
await pool.query ("DELETE FROM users WHERE id=?",[id]);
res.json ({ok:true})
})
// 退出后台登录
app.post ("/api/admin/logout",(req,res)=>{
req.session.destroy ();
res.json ({ok:true})
})
// 返回后台页面
app.get ("/admin",(req,res)=>{
res.sendFile (__dirname+"/public/admin.html")
})
// =========【放到所有接口的最后！！】=========
app.use ((req,res,next)=>{
if (req.method !== "GET") return next ();
if (req.url.includes (".")) return next ();
const htmlFile = path.join (__dirname,"public",req.url)+".html";
if (fs.existsSync (htmlFile)){
return res.sendFile (htmlFile);
}
next ();
})
app.get('/',(req,res)=>res.sendFile(path.join(__dirname,"public/index.html")))
//404 兜底
app.use ((req,res)=>{
res.status (404).send ("<h2>404 页面不存在</h2>")
})
//socket.io 连接监听
io.on ("connection", (socket) => {
console.log ("客户端已连接",socket.id);
socket.on ("disconnect", () => {
console.log ("客户端断开",socket.id);
});
});

const PORT=3000;
server.listen(PORT,"0.0.0.0",()=>{
console.log("服务启动成功");
console.log("监听：0.0.0.0:" + PORT);
console.log("后台地址：/admin");
});
