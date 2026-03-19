const express = require('express');
const cors = require('cors');
const axios = require('axios');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json());

// 激活码数据库
const activationCodes = new Map();
const userSessions = new Map();

const PRESET_CODES = [
  'MANJU-2024-VIP-001',
  'MANJU-2024-VIP-002', 
  'MANJU-2024-VIP-003',
  'MANJU-2024-PRO-001',
  'MANJU-2024-PRO-002',
  'MANJU-2024-BAS-001',
  'MANJU-2024-BAS-002',
  'MANJU-2024-BAS-003',
  'MANJU-2024-BAS-004',
  'MANJU-2024-BAS-005',
];

PRESET_CODES.forEach(code => {
  activationCodes.set(code, {
    code,
    type: code.includes('VIP') ? 'vip' : code.includes('PRO') ? 'pro' : 'basic',
    activated: false,
    deviceId: null
  });
});

// 验证激活码
app.post('/api/verify-code', (req, res) => {
  const { code, deviceId } = req.body;
  
  if (!code || !deviceId) {
    return res.json({ success: false, message: '缺少必要参数' });
  }
  
  const upperCode = code.toUpperCase().trim();
  const codeData = activationCodes.get(upperCode);
  
  if (!codeData) {
    return res.json({ success: false, message: '激活码无效' });
  }
  
  if (codeData.activated && codeData.deviceId !== deviceId) {
    return res.json({ success: false, message: '激活码已被其他设备使用' });
  }
  
  if (!codeData.activated) {
    codeData.activated = true;
    codeData.deviceId = deviceId;
  }
  
  const sessionToken = crypto.randomBytes(32).toString('hex');
  userSessions.set(sessionToken, {
    code: upperCode,
    deviceId,
    type: codeData.type
  });
  
  res.json({
    success: true,
    message: '激活成功',
    sessionToken,
    type: codeData.type
  });
});

// 验证会话
app.post('/api/verify-session', (req, res) => {
  const { sessionToken, deviceId } = req.body;
  
  if (!sessionToken || !deviceId) {
    return res.json({ success: false, message: '缺少必要参数' });
  }
  
  const session = userSessions.get(sessionToken);
  
  if (!session || session.deviceId !== deviceId) {
    return res.json({ success: false, message: '会话无效' });
  }
  
  res.json({
    success: true,
    type: session.type
  });
});

// AI 分镜生成
app.post('/api/generate-storyboard', async (req, res) => {
  const { sessionToken, deviceId, script, style, duration, baseUrl, apiKey, model } = req.body;
  
  const session = userSessions.get(sessionToken);
  if (!session || session.deviceId !== deviceId) {
    return res.json({ success: false, message: '会话无效' });
  }
  
  if (!apiKey) {
    return res.json({ success: false, message: '请配置API Key' });
  }
  
  try {
    const minShots = duration <= 1.5 ? 60 : duration <= 2 ? 100 : 120;
    const targetShots = session.type === 'vip' ? minShots + 20 : session.type === 'pro' ? minShots + 10 : minShots;
    
    const systemPrompt = `你是一位专业的AI漫剧分镜导演。请将用户提供的剧本转换为专业分镜脚本。

要求：
1. 生成${targetShots}个镜头
2. 风格：${style}
3. 时长：${duration}分钟
4. 每个镜头包含：镜头号、景别、画面描述、人物动作、台词、情绪、运镜、时长

输出格式为Markdown表格，表头：| 镜头号 | 景别 | 画面描述 | 人物动作 | 台词 | 情绪 | 运镜 | 时长 |`;

    const response = await axios.post(
      `${baseUrl}/chat/completions`,
      {
        model: model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `剧本内容：\n\n${script}\n\n请生成完整的分镜表格。` }
        ],
        temperature: 0.7,
        max_tokens: 4000
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 120000
      }
    );
    
    res.json({
      success: true,
      data: response.data.choices[0]?.message?.content || '',
      shotCount: targetShots
    });
    
  } catch (error) {
    res.json({
      success: false,
      message: 'AI调用失败: ' + (error.response?.data?.error?.message || error.message)
    });
  }
});

// 15秒分段
app.post('/api/generate-segments', async (req, res) => {
  const { sessionToken, deviceId, storyboard, style, duration, baseUrl, apiKey, model } = req.body;
  
  const session = userSessions.get(sessionToken);
  if (!session || session.deviceId !== deviceId) {
    return res.json({ success: false, message: '会话无效' });
  }
  
  const segmentCount = Math.floor(duration * 4);
  
  try {
    const systemPrompt = `你是一位专业的AI视频分段导演。请将分镜表转换为15秒一段的AI视频投产格式。

要求：
1. 将内容分为${segmentCount}个15秒段落
2. 每个段落包含：段落编号、时间范围、镜头列表、画面描述汇总、关键提示词
3. 格式适合即梦、可灵等AI视频平台使用

风格：${style}`;

    const response = await axios.post(
      `${baseUrl}/chat/completions`,
      {
        model: model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `分镜表内容：\n\n${storyboard}\n\n请生成15秒分段格式。` }
        ],
        temperature: 0.7,
        max_tokens: 4000
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 120000
      }
    );
    
    res.json({
      success: true,
      data: response.data.choices[0]?.message?.content || '',
      segmentCount
    });
    
  } catch (error) {
    res.json({
      success: false,
      message: 'AI调用失败: ' + (error.response?.data?.error?.message || error.message)
    });
  }
});

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`服务器运行在端口 ${PORT}`);
});