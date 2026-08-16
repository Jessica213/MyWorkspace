/* ============================================================
 * 成长工作台 · AI 每日内容生成（智谱 GLM-4-Flash）
 * ------------------------------------------------------------
 * 功能：
 *   1. 每日生成：阅读复述材料、英语口语话题、智慧锦囊
 *   2. 按日期缓存，每天只生成一次
 *   3. 生成失败回退到本地数据
 *   4. 支持手动"换一个"重新生成
 * ============================================================ */
(function () {
  'use strict';

  var CACHE_KEY = 'wb_growth_ai_daily';
  var WISDOM_KEY = 'wb_growth_ai_wisdom';

  // 获取 API Key
  function getApiKey() {
    if (window.APP_CONFIG && window.APP_CONFIG.zhipuApiKey) {
      return window.APP_CONFIG.zhipuApiKey;
    }
    try {
      var cfg = JSON.parse(localStorage.getItem('wb_growth_zhipu_config') || '{}');
      return cfg.apiKey || '';
    } catch (e) { return ''; }
  }

  // 检查是否配置了 API Key
  function isConfigured() {
    return !!getApiKey();
  }

  // 获取今天的日期字符串
  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  // 读取缓存
  function getCache() {
    try {
      var raw = localStorage.getItem(CACHE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  // 写入缓存
  function setCache(data) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(data));
    } catch (e) {}
  }

  // 调用智谱 AI API
  function callAI(prompt) {
    var apiKey = getApiKey();
    if (!apiKey) return Promise.reject(new Error('未配置智谱 API Key'));

    return fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey
      },
      body: JSON.stringify({
        model: 'glm-4-flash',
        messages: [
          { role: 'user', content: prompt }
        ],
        temperature: 0.8,
        max_tokens: 2000
      })
    }).then(function (res) {
      if (!res.ok) throw new Error('API 请求失败: ' + res.status);
      return res.json();
    }).then(function (data) {
      if (data.choices && data.choices[0] && data.choices[0].message) {
        return data.choices[0].message.content;
      }
      throw new Error('API 返回格式异常');
    });
  }

  // 生成阅读复述材料
  function generateReading() {
    var prompt = '请生成一篇适合做"阅读复述练习"的中文短文，要求：\n' +
      '1. 字数 300-500 字\n' +
      '2. 主题从以下类别中随机选一个：时政评论、社会现象、科技发展、人文思考、职场成长、心理学、健康生活\n' +
      '3. 内容要有观点、有逻辑，适合练习复述能力\n' +
      '4. 严格按照以下 JSON 格式返回，不要有其他文字：\n' +
      '{\n' +
      '  "title": "文章标题",\n' +
      '  "category": "类别名称",\n' +
      '  "material": "正文内容",\n' +
      '  "guide": "复述要点提示，1-2句话",\n' +
      '  "keyPoints": ["要点1", "要点2", "要点3", "要点4", "要点5"]\n' +
      '}';

    return callAI(prompt).then(function (text) {
      try {
        // 尝试提取 JSON
        var jsonStr = text;
        var start = text.indexOf('{');
        var end = text.lastIndexOf('}');
        if (start >= 0 && end > start) {
          jsonStr = text.substring(start, end + 1);
        }
        var obj = JSON.parse(jsonStr);
        obj.id = 'ai_' + Date.now().toString(36);
        obj.type = 'retell';
        return obj;
      } catch (e) {
        throw new Error('解析阅读材料失败');
      }
    });
  }

  // 生成英语口语话题
  function generateSpeaking() {
    var topics = ['日常话题', '工作话题', '观点表达', '社会问题', '文化交流', '个人成长', '科技影响', '环境问题'];
    var topic = topics[Math.floor(Math.random() * topics.length)];

    var prompt = '请生成一个英语口语练习话题，要求：\n' +
      '1. 话题类别：' + topic + '\n' +
      '2. 适合 1-2 分钟的口语表达练习\n' +
      '3. 严格按照以下 JSON 格式返回，不要有其他文字：\n' +
      '{\n' +
      '  "title": "话题标题（中英文）",\n' +
      '  "category": "' + topic + '",\n' +
      '  "topic": "话题描述，告诉学习者要说什么",\n' +
      '  "useful": ["常用句型1", "常用句型2", "常用句型3", "常用句型4", "常用句型5", "常用句型6"],\n' +
      '  "sample": "参考范文，150-250词左右的英文短文"\n' +
      '}';

    return callAI(prompt).then(function (text) {
      try {
        var jsonStr = text;
        var start = text.indexOf('{');
        var end = text.lastIndexOf('}');
        if (start >= 0 && end > start) {
          jsonStr = text.substring(start, end + 1);
        }
        var obj = JSON.parse(jsonStr);
        obj.id = 'ai_' + Date.now().toString(36);
        obj.type = 'speak';
        return obj;
      } catch (e) {
        throw new Error('解析口语话题失败');
      }
    });
  }

  // 生成智慧锦囊
  function generateWisdom() {
    var categories = ['名人名言', '网络热门语句', '美文摘录'];
    var category = categories[Math.floor(Math.random() * categories.length)];
    var prompt = '请随机生成一条"' + category + '"，要求：\n' +
      '1. 字数 15-60 字\n' +
      '2. 类别为：' + category + '\n' +
      '   - 名人名言：古今中外知名人物的经典语录，要注明作者\n' +
      '   - 网络热门语句：近期网络上流传较广、有共鸣的金句或段子\n' +
      '   - 美文摘录：文学作品、散文、诗歌中的优美句子，要注明出处\n' +
      '3. 内容积极正面、有启发性或共鸣感，语言精炼有文采\n' +
      '4. 严格按照以下 JSON 格式返回，不要有其他文字：\n' +
      '{\n' +
      '  "text": "句子内容",\n' +
      '  "source": "作者或出处"\n' +
      '}';

    return callAI(prompt).then(function (text) {
      try {
        var jsonStr = text;
        var start = text.indexOf('{');
        var end = text.lastIndexOf('}');
        if (start >= 0 && end > start) {
          jsonStr = text.substring(start, end + 1);
        }
        var obj = JSON.parse(jsonStr);
        return obj;
      } catch (e) {
        throw new Error('解析智慧锦囊失败');
      }
    });
  }

  // 生成全部每日内容
  function generateDaily() {
    return Promise.all([
      generateReading(),
      generateSpeaking(),
      generateWisdom()
    ]).then(function (results) {
      var data = {
        date: todayStr(),
        reading: results[0],
        speaking: results[1],
        wisdom: results[2]
      };
      setCache(data);
      return data;
    });
  }

  // 获取今日内容（有缓存用缓存，没有则生成）
  function getDaily() {
    var cache = getCache();
    if (cache && cache.date === todayStr() && cache.reading && cache.speaking) {
      return Promise.resolve(cache);
    }
    if (!isConfigured()) {
      return Promise.reject(new Error('未配置智谱 API Key'));
    }
    return generateDaily();
  }

  // 获取今日智慧锦囊（单独的，因为刷新频率可能不同）
  function getWisdom() {
    var cache = getCache();
    if (cache && cache.date === todayStr() && cache.wisdom) {
      return Promise.resolve(cache.wisdom);
    }
    if (!isConfigured()) {
      return Promise.reject(new Error('未配置'));
    }
    return generateWisdom().then(function (w) {
      var c = getCache() || { date: todayStr() };
      c.wisdom = w;
      c.date = todayStr();
      setCache(c);
      return w;
    });
  }

  // 刷新智慧锦囊（换一条）
  function refreshWisdom() {
    if (!isConfigured()) return Promise.reject(new Error('未配置'));
    return generateWisdom().then(function (w) {
      var c = getCache() || { date: todayStr() };
      c.wisdom = w;
      c.date = todayStr();
      setCache(c);
      return w;
    });
  }

  // 刷新阅读材料
  function refreshReading() {
    if (!isConfigured()) return Promise.reject(new Error('未配置'));
    return generateReading().then(function (r) {
      var c = getCache() || { date: todayStr() };
      c.reading = r;
      c.date = todayStr();
      setCache(c);
      return r;
    });
  }

  // 刷新口语话题
  function refreshSpeaking() {
    if (!isConfigured()) return Promise.reject(new Error('未配置'));
    return generateSpeaking().then(function (s) {
      var c = getCache() || { date: todayStr() };
      c.speaking = s;
      c.date = todayStr();
      setCache(c);
      return s;
    });
  }

  // 保存 API Key 配置
  function saveConfig(apiKey) {
    try {
      localStorage.setItem('wb_growth_zhipu_config', JSON.stringify({ apiKey: apiKey }));
      return true;
    } catch (e) { return false; }
  }

  // 对外暴露
  window.__aiContent = {
    isConfigured: isConfigured,
    getApiKey: getApiKey,
    saveConfig: saveConfig,
    getDaily: getDaily,
    getWisdom: getWisdom,
    refreshWisdom: refreshWisdom,
    refreshReading: refreshReading,
    refreshSpeaking: refreshSpeaking,
    generateDaily: generateDaily
  };
})();
