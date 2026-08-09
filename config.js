/* ============================================================
 * 成长工作台 · Supabase 配置
 * ------------------------------------------------------------
 * 方式一（推荐，无需改代码）：在应用内点击右上角「云同步」→「连接 Supabase」，
 *   填入项目 URL 和 anon 公钥即可，配置会保存在浏览器本地。
 * 方式二：直接把下面的占位符改成你的 Supabase 项目信息（可同时部署到多设备，
 *   每台设备首次打开会提示填写，也可统一用本文件预置）。
 * ============================================================ */
window.APP_CONFIG = {
  // 在 Supabase Dashboard → Project Settings → API 里找到
  supabaseUrl: "https://rtepokjsqlsqnftcella.supabase.co",    // 例如 https://xxxx.supabase.co
  anonKey: "sb_publishable_Iv261_6Y8dB-LyWmaskv0w_lyl1SGyq",        // 例如 eyJhbGciOi...

  // 智谱 AI API Key（用于每日生成阅读材料、口语练习、智慧锦囊）
  // 在 https://open.bigmodel.cn/ 注册获取，GLM-4-Flash 免费
  zhipuApiKey: "8668dc1423ea446dafcbf9f43780eec7.RPSu1Mrr5sxb94wh"     // 例如 12345678-1234-1234-1234-123456789012.xxxxxx
};
