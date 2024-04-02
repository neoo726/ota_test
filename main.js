// Modules to control application life and create native browser window
const { app, BrowserWindow,session,dialog, MenuItem, Menu  } = require('electron')
const path = require('node:path')
const mqtt = require('mqtt');
const disk = require('diskusage');
const os = require('os');

const decryptedConfig = decryptFromBase64(process.env.OTA_CONFIG);
const mqttClient = mqtt.connect(decryptedConfig.MQTT_URL);
const macAddress = getMacAddress();
const startTime = process.hrtime();

function createWindow () {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js')
    }
  })

  // and load the index.html of the app.
  mainWindow.loadFile('index.html')
  // 设置每小时执行一次 hotUpdate
  updateInterval = setInterval(async () => {
    await hotUpdate();
  }, 360000);

  const menuItem = new MenuItem({
    label:"Check Update",
    click:async ()=>{
      await hotUpdate();
    }
  });
  const menu =Menu.buildFromTemplate([
    {
      label:'Menu',
      submenu:[
        {role:'quit'}
      ]
    },{
      label:'Update',
      submenu:[menuItem]
    },{
      label:'tools',
      submenu:[
        {role:"reload"},
        {role:"toggleDevTools"}
      ]
    }
  ])
  Menu.setApplicationMenu(menu);

  mqttClient.on('connect', () => {
    console.log('Connected to MQTT broker');

    // 每30秒发布一条消息
    setInterval(() => {
      const interfaces = os.networkInterfaces();
      const nicsValue = [];
      for(const interfaceName in interfaces){
        const networkInterface = interfaces[interfaceName];
        for(const info of networkInterface){
          if(!info.internal){
            nicsValue.push({
              iface:interfaceName,
              ip:info.cidr,
              mac:info.mac,
              rx:0,
              speed:"",
              tx:0
            });
          }
        }
      }
      const statusValue={
        error:"",
        node:{
          cpu:{
            architecture:"",
            cores:0,
            frequency:0,
            name:"",
            temperature:0,
            usage:getCpuUsage()
          },
          disks:[{
            drive:"C",
            filesystem:"windows",
            total:getDiskUsage('C:\\').total,
            used:getDiskUsage('C:\\').used
          }],
          gpu:{
            name:"",
            temperature:0,
            usage:0
          },
          memory:{
            total:getMemoryUsage().total,
            used:getMemoryUsage().used
          },
          nics:nicsValue,
          platform:decryptedConfig.UPDATE_PLATFORM
        },
        phase:"online",
        release:[{
          currentVersion:app.getVersion(),
          details:{
            additionalProp1:{}
          },
          phase:"online",
          repository:"webcms-electron"
        }],
        timestamp:new Date().toISOString(),
        uid:decryptedConfig.uid,
        upTime: process.hrtime(startTime)[0]
      }
      console.log("status:",JSON.stringify(statusValue));
      mqttClient.publish('zicloud/ota/'+decryptedConfig.uid+'/status', JSON.stringify(statusValue));
    }, 30000);

    // 订阅消息
    mqttClient.subscribe('zicloud/ota/'+decryptedConfig.uid+'/cmd');
  });
  mqttClient.on('message', (topic, message) => {
    console.log(`Received message on topic ${topic}: ${message.toString()}`);

    // 在订阅到消息时调用
    if (topic === 'zicloud/ota/electron/cmd') {
      let code = 0;
      if(message.cmd=="update"){
        const response = fetch(message.payload.url)
        code = response.status;
        if(response.ok){
          const returnJson={
            Code:code,
            Error:"",
            Body:{

            }
          }
          mqttClient.publish(message.reply,JSON.stringify(returnJson))
          downloadUpdate(message.payload.url)
          BrowserWindow.getAllWindows().forEach((win) => {
            win.close();
          });
  
          // 等待 2 秒钟确保窗口关闭
          setTimeout(() => {
            // 重新启动应用程序
            app.relaunch({
              args: process.argv.slice(1)
            });
    
            // 退出应用程序
            app.exit(0);
            }, 2000);
        }else{
          const returnJson={
            Code:code,
            Error:"get url error",
            Body:{

            }
          }
          mqttClient.publish(message.reply,JSON.stringify(returnJson))
        }

      }else if (message.cmd == "write_settings"){
        
      }else if (message.cmd == "read_settings"){
        const readSettingsJson=[{
          description:'OTA API Session token',
          displayName:'session_token',
          groupName:'electron',
          key:'SESSION_TOKEN',
          readOnly:true,
          value:decryptedConfig.SESSION_TOKEN
        },{
          description:'ota server api url',
          displayName:'ota_url',
          groupName:'electron',
          key:'UPDATA_API',
          readOnly:true,
          value:decryptedConfig.UPDATE_API
        },{
          description:'mqtt server url',
          displayName:'mqtt_url',
          groupName:'electron',
          key:'MQTT_URL',
          readOnly:true,
          value:decryptedConfig.MQTT_URL
        },{
          description:'electron thread name',
          displayName:'name',
          groupName:'electron',
          key:'name',
          readOnly:true,
          value:decryptedConfig.name
        },{
          description:'electron thread uid',
          displayName:'uid',
          groupName:'electron',
          key:'uid',
          readOnly:true,
          value:decryptedConfig.uid
        },{
          description:'electron update channel',
          displayName:'channel',
          groupName:'electron',
          key:'UPDATE_CHANNEL',
          readOnly:false,
          value:process.env.UPDATE_CHANNEL
        },{
          description:'electron update platform',
          displayName:'platform',
          groupName:'electron',
          key:'UPDATE_PLATFORM',
          readOnly:false,
          value:process.env.UPDATE_PLATFORM
        }]
        const returnJson={
          Code:200,
          Error:"",
          Body:readSettingsJson
        }
        mqttClient.publish(message.reply,JSON.stringify(returnJson))
      }else{

      }
    }
  });
  // Open the DevTools.
  // mainWindow.webContents.openDevTools()
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit()
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
function ensureDirectoriesExist() {
  const directoriesToCreate = [
    path.join(__dirname, '../nginx-1.24.0/temp/client_body_temp'),
    // Add any other required directories here
  ];

  for (const directory of directoriesToCreate) {
    if (!fs.existsSync(directory)) {
      fs.mkdirSync(directory, { recursive: true });
    }
  }
}


function getMemoryUsage() {
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  const usedMemory = totalMemory - freeMemory;
  const memoryUsage = (usedMemory / totalMemory) * 100;

  return {
    total: totalMemory,
    free: freeMemory,
    used: usedMemory,
    usage: memoryUsage,
  };
}

// 辅助函数：格式化字节数
function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

function getDiskUsage(path) {
  const info = disk.checkSync(path);
  return {total:info.total,used:info.used};
}

function updateEnv(key, newValue) {
  const envPath = path.join(__dirname, '../.env');

  try {
    // 使用同步读取文件
    let data = fs.readFileSync(envPath, 'utf-8');

    // 构建正则表达式，匹配键（key）并且捕获其余部分
    const regex = new RegExp(`(${key}=)(.+)`);
    
    // 替换匹配的键值对
    data = data.replace(regex, `$1${newValue}`);

    // 使用同步写回文件
    fs.writeFileSync(envPath, data, 'utf-8');
    console.log(`Updated ${key} to ${newValue}`);
    
    // 打印更新后的内容
    const updatedContent = fs.readFileSync(envPath, 'utf-8');
    console.log('Updated .env content:', updatedContent);

    console.log(`Updated ${key} to ${newValue}`);
  } catch (err) {
    console.error('Error updating env:', err);
  }
}



function getLocalIP() {
  const interfaces = os.networkInterfaces();
  const localIPs = [];

  for (const interfaceName in interfaces) {
    const networkInterface = interfaces[interfaceName];

    for (const info of networkInterface) {
      // 只获取IPv4地址，忽略loopback地址
      if (info.family === 'IPv4' && !info.internal) {
        localIPs.push(info.address);
      }
    }
  }

  return localIPs;
}

function getCpuUsage() {
  const cpus = os.cpus();
  let totalIdle = 0;
  let totalTick = 0;

  cpus.forEach((cpu) => {
    for (const type in cpu.times) {
      totalTick += cpu.times[type];
    }
    totalIdle += cpu.times.idle;
  });

  return (1 - totalIdle / totalTick) * 100;
}

function getMacAddress() {
  const networkInterfaces = os.networkInterfaces();
  let macAddress = null;

  // 遍历网络接口
  Object.keys(networkInterfaces).forEach((interfaceName) => {
    const networkInterface = networkInterfaces[interfaceName];

    // 在当前网络接口中查找 MAC 地址
    const macInfo = networkInterface.find((info) => !info.internal && info.mac !== '00:00:00:00:00:00');

    if (macInfo) {
      macAddress = macInfo.mac;
    }
  });

  return macAddress;
}

// 加密函数
function encryptToBase64(data) {
  const jsonStr = JSON.stringify(data);
  const buffer = Buffer.from(jsonStr, 'utf-8');
  return buffer.toString('base64');
}

function decryptFromBase64(base64String) {
  try {
    const buffer = Buffer.from(base64String, 'base64');
    const jsonStr = buffer.toString('utf-8');
    return JSON.parse(jsonStr);
  } catch (error) {
    console.error('JSON Error:', error.message);
    return {}; // 返回null或根据需要适当处理错误
  }
}


function modifyMySQLConfig() {
  const mysqlConfigPath = path.join(__dirname, '../mysql//my.ini');
  const parentDir = path.resolve(__dirname, '..');

  // 同步读取配置文件内容
  try {
    let data = fs.readFileSync(mysqlConfigPath, 'utf8');

    let lines = data.split('\n');

    // 遍历每一行，进行修改
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes('basedir')) { 
        lines[i] = `basedir = ${parentDir}\\mysql`.replace(/\\/g, '\\\\');
      } else if (lines[i].toLowerCase().includes('datadir')) {
        lines[i] = `datadir = ${parentDir}\\mysql\\data`.replace(/\\/g, '\\\\');
      }
    }

    // 在这里可以使用正则表达式替换 basedir 的值
    //const modifiedData = data.replace(/basedir\s*=\s*[^(\r\n)]+/i, 'basedir = '+parentDir+"\\mysql").replace(/datadir\s*=\s*[^(\r\n)]+/i, 'datadir = '+parentDir+"\\mysql\\data").replace(/\\/g, '\\\\');


    // 同步写入修改后的内容到配置文件
    fs.writeFileSync(mysqlConfigPath, lines.join('\n'), 'utf8');
    console.log('MySQL config file modified successfully.');
  } catch (err) {
    console.error('Error modifying MySQL config file:', err);
  }
}
function downloadUpdate(downloadUrl) {
  return new Promise(async (resolve, reject) => {
    const filePath = path.join(baseUrl, 'update.zip');

    try {
      const response = await axios({
        method: 'get',
        url: downloadUrl,
        responseType: 'stream',
        headers: {
          Authorization: `Bearer ${decryptedConfig.SESSION_TOKEN}`
        }
      });

      const writer = fs.createWriteStream(filePath);

      response.data.pipe(writer);

      writer.on('finish', () => {
        writer.close();
        const unzip = new admZip(filePath);
        unzip.extractAllTo(baseUrl, true);
        resolve();
      });

      writer.on('error', (err) => {
        reject(err);
      });
    } catch (error) {
      reject(error);
    }
  });
}


async function hotUpdate() {
  return new Promise(async (resolve, reject) => {
    try {
      renewTimers = 0 ;
      const result = await checkAndPerformUpdate();
      if (result === 0){
        await dialog.showMessageBox({
          type: 'info',
          title: '更新检查',
          message:'检查完成,已是最新版本',
          buttons:['关闭']
        })
      }
      else if(result===1){
        await dialog.showMessageBox({
          type:"warning",
          title:'取消更新',
          message:"已取消此次更新",
          buttons:['关闭']
        })
      }
      else{
        await dialog.showMessageBox({
          type:"warning",
          title:'取消更新',
          message:"更新失败 请稍后重试",
          buttons:['关闭']
        })
      }
      // 其他热更新相关的逻辑
      resolve();
    } catch (error) {
      console.error('update Error:', error.message);
      reject(error);
    }
  });
}


async function checkAndPerformUpdate() {
  currentVersion= app.getVersion();
  platform = "windows";
  try {
    const updateInfo = await axios.get(decryptedConfig.UPDATE_API+'electron/checkUpdate', {
      params: { currentVersion, platform },
      headers: {
        Authorization: `${decryptedConfig.SESSION_TOKEN}`
      }
    });
    console.log("status:",updateInfo.status);
    if (updateInfo.status == 401){
    }
    if (updateInfo && (updateInfo.data)[0].version && ((updateInfo.data)[0].version !==  currentVersion)) {
      const userResponse = await dialog.showMessageBox({
        type: 'info',
        title: '发现新版本',
        message: '有新版本可用，是否立即更新？\r\n当前版本为:'+currentVersion+"\r\n远程最新版本为:"+(updateInfo.data)[0].version+"\r\n更新内容:"+updateInfo.data.notes,
        buttons: ['是', '否']
      });
      if (userResponse.response === 0) {
        // 用户选择更新，开始下载并安装
        await downloadUpdate(updateInfo.data.url);
      }else{
        return 1
      }
      // 下载完成后的操作
      const installResponse = await dialog.showMessageBox({
        type: 'info',
        title: '更新完成',
        message: '更新完成，请重启',
        buttons: ['是']
      });

      if (installResponse.response === 0) {
        // 关闭所有窗口
        BrowserWindow.getAllWindows().forEach((win) => {
          win.close();
        });

        // 等待 2 秒钟确保窗口关闭
      setTimeout(() => {
        // 重新启动应用程序
        app.relaunch({
          args: process.argv.slice(1)
        });

        // 退出应用程序
        app.exit(0);
        }, 2000);
      }
    } else {
      console.log("updateInfo.version:",(updateInfo.data)[0].version)
      console.log("currentVersion:",currentVersion)
      // 当前已是最新版本
      console.log('Now is the leatest');
      return 0;
    }
  } catch (error) {
    console.log('update check error:', error.message);
    if(error.message.includes("401")){
      const postData = {
        "hostname":"Local",
        "ip": getLocalIP()[0],
        "mac":macAddress,
        "name":decryptedConfig.name,
        "uid":decryptedConfig.uid,
      }
      const response = await axios.post(decryptedConfig.UPDATE_API+'agent/register',postData);
      console.log(response.data);
      decryptedConfig.SESSION_TOKEN=response.data.accessToken;
      decryptedConfig.uid = response.data.agent.uid;
      decryptedConfig.name = response.data.agent.name;
      updateEnv('OTA_CONFIG', encryptToBase64(decryptedConfig));
      if(renewTimers ==0 ){
        renewTimers =1;
        checkAndPerformUpdate();
      }else{
        return 2;
      }
    }
  }
}
