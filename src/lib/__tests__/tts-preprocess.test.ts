import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { preprocessTTS, PRONUNCIATION_MAP, ZH_TW_MAP, getActiveRules } from '../tts-preprocess';

describe('preprocessTTS', () => {
  describe('字典 metadata 完整性', () => {
    it('每條 PRONUNCIATION_MAP 都有 replacement / strategy / reason / provider / addedAt', () => {
      for (const [k, v] of Object.entries(PRONUNCIATION_MAP)) {
        expect(v.replacement, `${k} 缺 replacement`).toBeTruthy();
        expect(v.strategy, `${k} 缺 strategy`).toMatch(/^(phonetic|semantic)$/);
        expect(v.reason, `${k} 缺 reason`).toBeTruthy();
        expect(v.provider, `${k} 缺 provider`).toMatch(/^(elevenlabs|minimax|all)$/);
        expect(v.addedAt, `${k} 缺 addedAt`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    });

    it('每條 ZH_TW_MAP 都有完整 metadata', () => {
      for (const [k, v] of Object.entries(ZH_TW_MAP)) {
        expect(v.replacement, `${k} 缺 replacement`).toBeTruthy();
        expect(v.strategy, `${k} 缺 strategy`).toMatch(/^(phonetic|semantic)$/);
        expect(v.reason, `${k} 缺 reason`).toBeTruthy();
        expect(v.provider, `${k} 缺 provider`).toMatch(/^(elevenlabs|minimax|all)$/);
        expect(v.addedAt, `${k} 缺 addedAt`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    });

    it('PRONUNCIATION_MAP 條數應為 169（migration baseline）', () => {
      expect(Object.keys(PRONUNCIATION_MAP).length).toBe(169);
    });

    it('ZH_TW_MAP 條數應為 82（migration baseline）', () => {
      expect(Object.keys(ZH_TW_MAP).length).toBe(82);
    });
  });

  describe('破音字替換 — 各分組代表案例', () => {
    const cases: Array<[string, string, string]> = [
      ['顯著', '顯住', '著 zhù'],
      ['重複', '蟲複', '重 chóng'],
      ['音樂', '音約', '樂 yuè'],
      ['銀行', '銀航', '行 háng'],
      ['進行', '進形', '行 xíng'],
      ['董事長', '董事掌', '長 zhǎng'],
      ['調整', '調枕', '調 tiáo（避「條整」被「協調」誤觸）'],
      ['調查', '掉查', '調 diào'],
      ['效率', '效律', '率 lǜ'],
      ['深刻', '深克', '刻 kè'],
      ['卸妝露', '卸妝陸', '露 lù'],
      ['頭髮', '頭法', '髮 fǎ'],
      ['累積', '壘積', '累 lěi'],
      ['到處', '到楚', '處 chù'],
      ['反應', '反印', '應 yìng'],
      ['應該', '英該', '應 yīng'],
      ['數據', '樹據', '數 shù'],
      ['投降', '投項', '降 xiáng'],
      ['便宜', '便移', '便宜 pián yí'],
      ['遊說', '遊稅', '說 shuì'],
      ['一切', '一且', '切 qiè'],
      ['出差', '出拆', '差 chāi'],
      ['歸還', '歸環', '還 huán'],
      ['測量', '測良', '量 liáng'],
      ['人脈', '人賣', '脈 mài'],
      ['執行長', '執形掌', '行 xíng + 長 zhǎng 雙雷'],
      ['推薦', '推劍', '薦 jiàn'],
      ['瓶頸', '平緊', '頸 jǐng'],
      ['空殼', '空渴', '殼 ké'],
      ['校稿', '叫搞', '校 jiào'],
      ['執案', '直案', '執 zhí'],
      ['還在', '孩在', '還 hái'],
      ['睡覺', '睡叫', '覺 jiào'],
      ['禮儀', '禮疑', '儀 yí'],
      ['了解', '料解', '了 liǎo'],
      ['曾經', '層經', '曾 céng'],
      ['參與', '參預', '與 yù'],
    ];
    it.each(cases)('「%s」→「%s」(%s)', (input, expected) => {
      expect(preprocessTTS(input)).toBe(expected);
    });
  });

  describe('中台用語 — 代表案例', () => {
    const cases: Array<[string, string]> = [
      ['軟件', '軟體'],
      ['硬件', '硬體'],
      ['視頻', '影片'],
      ['數據庫', '資料庫'],
      ['打印機', '印表機'],
      ['文件夾', '資料夾'],
      ['鼠標', '滑鼠'],
      ['用戶', '使用者'],
    ];
    it.each(cases)('「%s」→「%s」', (input, expected) => {
      expect(preprocessTTS(input)).toBe(expected);
    });
  });

  describe('鏈式替換（ZH_TW 跑完換 PRONUNCIATION）', () => {
    it('「重啟」→ ZH_TW「重新啟動」→ PRONUNCIATION「蟲新啟動」', () => {
      expect(preprocessTTS('重啟')).toBe('蟲新啟動');
    });

    it('「設置」→ ZH_TW「設定」（設不在破音字典裡，輸出穩定）', () => {
      expect(preprocessTTS('設置')).toBe('設定');
    });
  });

  describe('長詞優先 regression', () => {
    it('「執行長」（3 字）優先於「行（1字）」與「長（1字）」', () => {
      expect(preprocessTTS('執行長')).toBe('執形掌');
    });

    it('「日積月累」（4 字）優先於「累積」（2 字）', () => {
      expect(preprocessTTS('日積月累')).toBe('日積月壘');
    });

    it('「生命禮儀」（4 字）優先於「禮儀」（2 字）', () => {
      expect(preprocessTTS('生命禮儀')).toBe('生命禮疑');
    });

    it('「大便宜」（3 字）優先於「便宜」（2 字）', () => {
      expect(preprocessTTS('大便宜')).toBe('大便移');
    });
  });

  describe('Markdown 清除', () => {
    it('bold **text** → text', () => {
      expect(preprocessTTS('這是 **重要** 的事')).toBe('這是 蟲要 的事'.replace('蟲要', '重要')); // 重要不在字典，保留
    });

    it('簡單 markdown 移除（heading / list / italic / code）', () => {
      // preprocessTTS 結尾會 trim，所以末尾換行會被吃掉
      expect(preprocessTTS('# 標題\n- 一項\n*斜體*\n`code`')).toBe('標題\n一項\n斜體');
    });

    it('image markdown ![alt](url) → alt 文字', () => {
      expect(preprocessTTS('![圖片](https://x.com/a.jpg)')).toBe('');
      expect(preprocessTTS('![描述](https://x.com/a.jpg)')).toBe('描述');
    });

    it('link [text](url) → text', () => {
      expect(preprocessTTS('看 [這裡](https://x.com)')).toBe('看 這裡');
    });

    it('裸 URL 直接刪除', () => {
      expect(preprocessTTS('連結 https://example.com 看')).toBe('連結  看');
    });

    it('IMAGE_URL: 直接刪除（非 URL token 形式）', () => {
      // 註：URL regex 跑在 IMAGE_URL 之前，含 https 的會先被部分吃掉
      expect(preprocessTTS('IMAGE_URL:abc123 後文')).toBe('後文');
    });
  });

  describe('思考標籤清除', () => {
    it('<thinking>...</thinking> 移除', () => {
      expect(preprocessTTS('<thinking>內部</thinking>外部')).toBe('外部');
    });

    it('<think>...</think> 移除', () => {
      expect(preprocessTTS('<think>內部</think>外部')).toBe('外部');
    });

    it('全形「（思考：...）」移除', () => {
      expect(preprocessTTS('（思考：內部）外部')).toBe('外部');
    });

    it('半形「(thinking: ...)」移除', () => {
      expect(preprocessTTS('(thinking: internal)external')).toBe('external');
    });
  });

  describe('logging context', () => {
    let logSpy: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
      logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    });
    afterEach(() => {
      logSpy.mockRestore();
    });

    it('命中規則時 emit [TTS-fix] log', () => {
      preprocessTTS('銀行', { route: 'tts', provider: 'elevenlabs', characterId: 'mayun' });
      expect(logSpy).toHaveBeenCalledTimes(1);
      const callArgs = logSpy.mock.calls[0];
      expect(callArgs[0]).toBe('[TTS-fix]');
      const payload = JSON.parse(callArgs[1] as string);
      expect(payload.route).toBe('tts');
      expect(payload.provider).toBe('elevenlabs');
      expect(payload.characterId).toBe('mayun');
      expect(payload.hits).toEqual([
        expect.objectContaining({ original: '銀行', replacement: '銀航', map: 'pronunciation' }),
      ]);
    });

    it('沒命中不 log', () => {
      preprocessTTS('完全沒問題的句子吧');
      expect(logSpy).not.toHaveBeenCalled();
    });

    it('不傳 ctx 也能 log（route/characterId 省略，provider 用預設 elevenlabs）', () => {
      preprocessTTS('銀行');
      expect(logSpy).toHaveBeenCalledTimes(1);
      const payload = JSON.parse(logSpy.mock.calls[0][1] as string);
      expect(payload.route).toBeUndefined();
      expect(payload.provider).toBe('elevenlabs'); // Phase 2.2 後 provider 永遠有值
      expect(payload.characterId).toBeUndefined();
      expect(payload.hits.length).toBe(1);
    });
  });

  describe('Phase 2.2 provider-aware', () => {
    it('不傳 provider 預設走 ElevenLabs', () => {
      expect(preprocessTTS('銀行')).toBe('銀航');
    });

    it('明確 provider=elevenlabs 行為相同', () => {
      expect(preprocessTTS('銀行', { provider: 'elevenlabs' })).toBe('銀航');
    });

    it('provider=minimax 時 MiniMax 規則為空 → 退化為 ElevenLabs', () => {
      // Task 2.4 校對後此 expected 會變動
      expect(preprocessTTS('銀行', { provider: 'minimax' })).toBe('銀航');
    });

    it('getActiveRules(elevenlabs) 條數 = 169（baseline）', () => {
      expect(Object.keys(getActiveRules('elevenlabs')).length).toBe(169);
    });

    it('getActiveRules(minimax) 目前等於 ElevenLabs（規則空 + 白名單空）', () => {
      expect(Object.keys(getActiveRules('minimax')).length).toBe(169);
    });

    it('log 顯示實際使用的 provider（包含預設值）', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      preprocessTTS('銀行'); // 沒傳 ctx
      const payload = JSON.parse(logSpy.mock.calls[0][1] as string);
      expect(payload.provider).toBe('elevenlabs'); // 預設值有 log 出來
      logSpy.mockRestore();
    });
  });

  describe('邊界', () => {
    it('空字串', () => {
      expect(preprocessTTS('')).toBe('');
    });

    it('純空白會被 trim', () => {
      expect(preprocessTTS('   \n  ')).toBe('');
    });

    it('沒任何匹配的句子原文回傳（去尾巴空白）', () => {
      expect(preprocessTTS('這句話完全沒問題吧。')).toBe('這句話完全沒問題吧。');
    });
  });
});
