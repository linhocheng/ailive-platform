/**
 * POST /api/tts
 * 文字轉語音 — ElevenLabs flash_v2_5
 * Body: { text: string, voiceId?: string, gender?: 'female' | 'male' }
 * Return: audio/mpeg stream
 */
import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 30;

const VOICE_FEMALE = '56hCnQE2rYMllQDw3m1o';
const VOICE_MALE   = '3D8gZpoA8QiwNEOs2oE7';

// ===== 中台用語轉換（先跑）=====
const ZH_TW_MAP: Record<string, string> = {
  // 多媒體
  '短視頻': '短影音', '視頻': '影片',
  // 科技
  '互聯網': '網際網路', '信息': '資訊', '軟件': '軟體', '硬件': '硬體',
  '網絡': '網路', '數據庫': '資料庫', '算法': '演算法', '概率': '機率',
  '編程': '程式設計', '源代碼': '原始碼', '代碼': '程式碼', '程序': '程式',
  '開源': '開放原始碼',
  // 硬體
  '鼠標': '滑鼠', '打印機': '印表機', '打印': '列印', '內存': '記憶體',
  '硬盤': '硬碟', '光盤': '光碟', '屏幕': '螢幕',
  // 系統操作
  '文件夾': '資料夾', '文件': '檔案', '菜單': '選單', '界面': '介面',
  '用戶': '使用者', '服務器': '伺服器', '默認': '預設', '兼容': '相容',
  '字符': '字元',
  // 平台
  '移動端': '行動裝置', '手機端': '手機版', '博客': '部落格', '在線': '線上',
  // 操作
  '支持': '支援', '反饋': '回饋', '激活': '啟用', '登錄': '登入',
  '退出': '登出', '保存': '儲存', '另存為': '另存新檔', '粘貼': '貼上',
  '復制': '複製', '剪切': '剪下',
  // 網路
  '文本': '文字', '超鏈接': '超連結', '鏈接': '連結', '搜索引擎': '搜尋引擎',
  '搜索': '搜尋', '優化': '最佳化', '性能': '效能', '帶寬': '頻寬',
  '緩存': '快取',
  // 多媒體
  '數碼': '數位', '模擬': '類比', '分辨率': '解析度', '幀率': '影格率', '碼率': '位元率',
  // 系統管理
  '重啟': '重新啟動', '內置': '內建', '外置': '外接', '端口': '連接埠',
  '協議': '通訊協定',
  // 安全
  '殺毒': '防毒', '黑客': '駭客', '賬號': '帳號', '賬戶': '帳戶',
  // 設定
  '設置': '設定', '配置': '設定', '模塊': '模組', '組件': '元件',
  '插件': '外掛程式', '擴展': '擴充功能',
  // 版本
  '卸載': '解除安裝', '運行': '執行',
  // 介面
  '窗口': '視窗', '標簽': '分頁', '書簽': '書籤', '收藏': '我的最愛',
  '歷史記錄': '瀏覽記錄', '快捷鍵': '快速鍵',
};

// ===== 破音字替換（後跑）=====
const PRONUNCIATION_MAP: Record<string, string> = {
  // 著
  '明顯著': '明顯住', '顯著地': '顯住地', '顯著': '顯住',
  '著重': '注重', '執著': '執住', '著實': '確實',
  // 量
  '測量': '測良', '衡量': '衡良', '打量': '打良',
  '估量': '估良', '思量': '思良', '商量': '商良',
  // 重
  '重複': '蟲複', '重疊': '蟲疊', '重新': '蟲新', '重演': '蟲演',
  // 調
  '調查': '掉查', '強調': '強掉', '協調': '協掉',
  '調整': '條整', '調節': '條節', '調和': '條和',
  // 樂
  '音樂': '音約', '樂器': '約器', '樂團': '約團', '樂曲': '約曲',
  // 行
  '銀行': '銀航', '行列': '航列', '行業': '航業',
  '同行': '同航', '外行': '外航',
  // 長
  '董事長': '董事掌', '成長': '成掌', '生長': '生掌', '增長': '增掌',
  '家長': '家掌', '校長': '校掌', '部長': '部掌', '市長': '市掌',
  '會長': '會掌', '長大': '掌大',
  // 降
  '投降': '投項', '降伏': '項伏',
  // 處
  '處處': '楚楚', '到處': '到楚', '四處': '四楚', '各處': '各楚',
  '隨處': '隨楚', '住處': '住楚', '相處': '相楚', '處境': '楚境', '處於': '楚於',
  // 便
  '大便宜': '大便移', '便宜': '便移',
  // 說
  '遊說': '遊稅', '說客': '稅客', '說服': '稅服',
  // 切
  '一切': '一且', '親切': '親且', '迫切': '迫且', '切實': '且實',
  '懇切': '懇且', '貼切': '貼且', '切合': '且合',
  // 數
  '數學': '樹學', '數字': '樹字', '數據': '樹據',
  '分數': '分樹', '次數': '次樹', '數量': '樹量', '數值': '樹值',
  // 率
  '效率': '效律', '機率': '機律', '比率': '比律', '頻率': '頻律',
  // 得
  '覺得': '覺的', '使得': '使的', '顯得': '顯的', '懂得': '懂的',
  '值得': '值的', '記得': '記的', '曉得': '曉的', '難得': '難的',
  // 了
  '瞭解': '料解', '瞭然': '料然', '了解': '料解', '明了': '明料',
  // 曾
  '曾經': '層經', '未曾': '未層', '何曾': '何層',
  // 差
  '出差': '出拆', '差事': '拆事', '當差': '當拆',
  // 還
  '歸還': '歸環', '還給': '環給', '償還': '償環', '交還': '交環', '退還': '退環',
  // 其他
  '參與': '參預', '背景': '背境',
};

function preprocessForTTS(text: string): string {
  let result = text;

  // Step 1: 中台用語轉換（長詞優先）
  const twKeys = Object.keys(ZH_TW_MAP).sort((a, b) => b.length - a.length);
  for (const key of twKeys) {
    result = result.replaceAll(key, ZH_TW_MAP[key]);
  }

  // Step 2: 破音字替換（長詞優先）
  const pronKeys = Object.keys(PRONUNCIATION_MAP).sort((a, b) => b.length - a.length);
  for (const key of pronKeys) {
    result = result.replaceAll(key, PRONUNCIATION_MAP[key]);
  }

  return result;
}

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) return NextResponse.json({ error: 'ELEVENLABS_API_KEY 未設定' }, { status: 500 });

    const { text, voiceId, gender } = await req.json();
    if (!text) return NextResponse.json({ error: 'text 必填' }, { status: 400 });

    // 預處理：中台用語 + 破音字
    const processedText = preprocessForTTS(text);

    // 選聲音
    const selectedVoice = voiceId || (gender === 'male' ? VOICE_MALE : VOICE_FEMALE);

    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${selectedVoice}`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
          'Accept': 'audio/mpeg',
        },
        body: JSON.stringify({
          text: processedText,
          model_id: 'eleven_flash_v2_5',
          voice_settings: {
            stability: 0.75,
            similarity_boost: 0.75,
            speed: 1.05,
          },
        }),
      }
    );

    if (!res.ok) {
      const err = await res.text();
      return NextResponse.json({ error: `ElevenLabs 錯誤: ${err}` }, { status: 500 });
    }

    const audioBuffer = await res.arrayBuffer();
    return new NextResponse(audioBuffer, {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'no-store',
      },
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
