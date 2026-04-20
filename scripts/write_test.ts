import { detectGear } from '../src/lib/llm-router';
const samples = [
  '幫我寫一篇關於慕斯花的文',
  '寫個發文',
  '寫一篇',
  '幫我發文',
  '草稿幫我想一下',
  '來篇 IG',
  '幫我想個文案',
  '給我一篇介紹',
  '我要寫貼文',
  '發個文',
  '文案幫我',
  '寫 post',
  '來個文案',
  '給我一段介紹文',
  '想一段推薦',
  '幫我想個 hashtag',
  '我想發一篇',
  '幫我擬一篇',
  '文章幫忙',
  '文案',
  'po 一篇',
  '發一篇',
];
for (const s of samples) {
  const gear = detectGear(s, 5);
  console.log(`${gear === 'sonnet' ? '🟢 SONNET' : '🔴 HAIKU '}  "${s}"`);
}
