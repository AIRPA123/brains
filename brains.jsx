import React, { useEffect, useMemo, useState, useRef } from "react";
import { motion } from "framer-motion";

// 기본 설명:
// - 단일 파일 React 컴포넌트입니다. Vite / Create React App에 붙여넣어 바로 사용 가능.
// - TailwindCSS가 프로젝트에 설정되어 있어야 합니다.
// - framer-motion이 설치되어 있어야 합니다: `npm i framer-motion`
// - 노년층 접근성을 고려해 큰 버튼, 음성 안내, 간단한 설정을 제공합니다.
// - 난이도 자동 조절: 최근 게임 성과(완료 속도, 시도 횟수)를 바탕으로 난이도를 올리거나 내립니다.
// - 이미지 대신 이모지를 사용하여 네트워크 의존성을 줄였습니다.

// 사용법(요약):
// 1) 프로젝트에 이 파일을 넣고 import MemoryGame from './MemoryGame';
// 2) <MemoryGame /> 를 렌더링하면 됩니다.

// ---------------------- 유틸 / 상수 ----------------------
const EMOJI_POOL = [
  "🍎","🍌","🍇","🍓","🍒","🍑","🥝","🍍",
  "🐶","🐱","🐭","🐻","🐼","🐨","🦊","🐵",
  "⚽","🏀","🎲","🎯","🎵","🎹","🎸","🎺",
];

const DIFFICULTY_LEVELS = [
  { id: "easy", pairs: 4, targetMoves: 12, targetSeconds: 90 },
  { id: "medium", pairs: 6, targetMoves: 20, targetSeconds: 120 },
  { id: "hard", pairs: 8, targetMoves: 30, targetSeconds: 180 },
];

const SPEECH = (text) => {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "ko-KR";
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
};

// ---------------------- 카드 생성 ----------------------
function generateDeck(pairs) {
  const emojis = EMOJI_POOL.slice(0, pairs);
  const deck = [];
  emojis.forEach((e, i) => {
    deck.push({ id: `${i}-a`, emoji: e, matched: false });
    deck.push({ id: `${i}-b`, emoji: e, matched: false });
  });
  // Fisher-Yates shuffle
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

// ---------------------- 메인 컴포넌트 ----------------------
export default function MemoryGame() {
  // 퍼포먼스 기록(최근 N 라운드). 성공시 timeInSeconds, moves; 실패 or 미완료는 null로 표기
  const [performanceHistory, setPerformanceHistory] = useState(() => {
    try {
      const raw = localStorage.getItem("mg_performance");
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  });

  // 현재 난이도 인덱스 (0:easy,1:medium,2:hard)
  const [levelIndex, setLevelIndex] = useState(() => {
    const raw = localStorage.getItem("mg_levelIndex");
    return raw ? Number(raw) : 1; // 기본 medium
  });

  const level = DIFFICULTY_LEVELS[levelIndex];
  const [deck, setDeck] = useState(() => generateDeck(level.pairs));

  const [flipped, setFlipped] = useState([]); // 선택된 카드 인덱스
  const [moves, setMoves] = useState(0);
  const [matchedCount, setMatchedCount] = useState(0);
  const [startedAt, setStartedAt] = useState(null);
  const [seconds, setSeconds] = useState(0);
  const timerRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(() => {
    const raw = localStorage.getItem("mg_voice");
    return raw ? JSON.parse(raw) : true;
  });

  // 난이도 자동조절: 게임 종료 후 호출
  function adaptDifficulty(success, timeSec, movesCount) {
    const record = { success, timeSec: success ? timeSec : null, moves: success ? movesCount : null, timestamp: Date.now(), level: level.id };
    const next = [...performanceHistory, record].slice(-7); // 마지막 7개만 보관
    setPerformanceHistory(next);
    localStorage.setItem("mg_performance", JSON.stringify(next));

    // 간단한 룰: 최근 3번 중 2번 이상 성공하면 난이도 올리기, 2번 이상 실패하면 낮추기
    const last3 = next.slice(-3);
    const successCount = last3.filter(r => r.success).length;
    if (last3.length >= 3 && successCount >= 2 && levelIndex < DIFFICULTY_LEVELS.length - 1) {
      setLevelIndex(prev => {
        const nv = prev + 1;
        localStorage.setItem("mg_levelIndex", String(nv));
        return nv;
      });
      if (voiceEnabled) SPEECH("성공이 많아요. 난이도를 한 단계 올렸습니다.");
    }
    if (last3.length >= 3 && successCount <= 1 && levelIndex > 0) {
      setLevelIndex(prev => {
        const nv = prev - 1;
        localStorage.setItem("mg_levelIndex", String(nv));
        return nv;
      });
      if (voiceEnabled) SPEECH("성공이 적어 난이도를 한 단계 낮췄습니다.");
    }
  }

  // 새로운 라운드 시작
  function resetGame(customLevelIndex = null) {
    const idx = customLevelIndex ?? levelIndex;
    const lvl = DIFFICULTY_LEVELS[idx];
    setDeck(generateDeck(lvl.pairs));
    setFlipped([]);
    setMoves(0);
    setMatchedCount(0);
    setStartedAt(Date.now());
    setSeconds(0);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => setSeconds(s => s + 1), 1000);
    if (voiceEnabled) SPEECH(`${lvl.pairs}쌍의 카드 게임을 시작합니다. 즐겁게 플레이하세요.`);
  }

  // 첫 로드: 게임 시작
  useEffect(() => {
    resetGame();
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 난이도 변경 시 새 덱 생성
  useEffect(() => {
    resetGame(levelIndex);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [levelIndex]);

  // 카드 클릭 처리
  function onCardClick(index) {
    if (busy) return;
    if (flipped.includes(index)) return;
    if (deck[index].matched) return;

    const newFlipped = [...flipped, index];
    setFlipped(newFlipped);

    if (newFlipped.length === 2) {
      setBusy(true);
      setMoves(m => m + 1);
      const [a, b] = newFlipped;
      if (deck[a].emoji === deck[b].emoji) {
        // 매칭
        setTimeout(() => {
          setDeck(prev => {
            const copy = [...prev];
            copy[a] = { ...copy[a], matched: true };
            copy[b] = { ...copy[b], matched: true };
            return copy;
          });
          setMatchedCount(c => c + 1);
          setFlipped([]);
          setBusy(false);
          if (voiceEnabled) SPEECH("짝을 찾았습니다! 잘하셨어요.");
        }, 600);
      } else {
        // 실패
        setTimeout(() => {
          setFlipped([]);
          setBusy(false);
          if (voiceEnabled) SPEECH("다시 시도해 보세요.");
        }, 900);
      }
    }
  }

  // 게임 종료 체크
  useEffect(() => {
    const totalPairs = level.pairs;
    if (matchedCount >= totalPairs) {
      // 성공
      if (timerRef.current) clearInterval(timerRef.current);
      const elapsed = Math.round((Date.now() - startedAt) / 1000);
      adaptDifficulty(true, elapsed, moves);
      if (voiceEnabled) SPEECH(`축하합니다! 게임을 완료하셨습니다. ${elapsed}초 걸렸습니다.`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchedCount]);

  // 타임아웃(선택적): 목표 시간을 넘기면 실패로 처리
  useEffect(() => {
    if (!startedAt) return;
    const target = level.targetSeconds * 1.5; // 여유를 조금 둔다
    if (seconds > target) {
      if (timerRef.current) clearInterval(timerRef.current);
      adaptDifficulty(false, null, null);
      if (voiceEnabled) SPEECH("제한 시간을 초과했습니다. 다음 번에는 더 잘하실 수 있어요.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seconds]);

  // 설정 저장
  useEffect(() => {
    localStorage.setItem("mg_voice", JSON.stringify(voiceEnabled));
  }, [voiceEnabled]);

  // ---------- UI 렌더링 ----------
  const gridCols = Math.ceil(Math.sqrt(level.pairs * 2));

  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 to-amber-100 p-6 flex items-start justify-center">
      <div className="w-full max-w-4xl">
        <header className="mb-4 flex items-center justify-between">
          <h1 className="text-3xl md:text-4xl font-bold text-amber-800">기억력 매칭 게임</h1>
          <div className="text-right text-sm text-amber-700">
            <div>난이도: <strong>{level.id}</strong></div>
            <div>쌍 수: <strong>{level.pairs}</strong></div>
          </div>
        </header>

        <section className="mb-4 bg-white p-4 rounded-2xl shadow-lg">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="text-lg">시간: <strong>{seconds}s</strong></div>
              <div className="text-lg">시도: <strong>{moves}</strong></div>
              <div className="text-lg">맞춘 쌍: <strong>{matchedCount}/{level.pairs}</strong></div>
            </div>

            <div className="flex items-center gap-2">
              <button
                className="px-4 py-2 bg-amber-600 text-white rounded-xl text-lg shadow hover:bg-amber-700"
                onClick={() => resetGame()}
                aria-label="새 게임 시작">
                새 게임
              </button>

              <select
                className="px-3 py-2 rounded-xl text-lg"
                value={levelIndex}
                onChange={(e) => setLevelIndex(Number(e.target.value))}
                aria-label="난이도 선택">
                {DIFFICULTY_LEVELS.map((d, i) => (
                  <option key={d.id} value={i}>{d.id} ({d.pairs}쌍)</option>
                ))}
              </select>

              <label className="flex items-center gap-2 text-sm ml-2">
                <input type="checkbox" checked={voiceEnabled} onChange={(e) => setVoiceEnabled(e.target.checked)} /> 음성안내
              </label>
            </div>
          </div>
        </section>

        <main>
          <div className={`grid grid-cols-${gridCols} gap-3 md:gap-4`}>
            {/* 간단한 방식: 인라인 스타일로 gridTemplateColumns를 지정 */}
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))`, gap: 12 }}>
              {deck.map((card, idx) => {
                const isFlipped = flipped.includes(idx) || card.matched;
                return (
                  <motion.button
                    key={card.id}
                    onClick={() => onCardClick(idx)}
                    className={`w-full aspect-[3/4] rounded-2xl shadow-md focus:outline-none focus:ring-4 focus:ring-amber-300 p-2`}
                    whileTap={{ scale: 0.98 }}
                    aria-label={`카드 ${idx + 1}`}
                  >
                    <motion.div
                      className="relative w-full h-full flex items-center justify-center text-4xl md:text-5xl"
                      animate={{ rotateY: isFlipped ? 0 : 180 }}
                      transition={{ duration: 0.45 }}
                      style={{ transformStyle: "preserve-3d" }}
                    >
                      {/* 앞면 */}
                      <div className={`absolute inset-0 backface-hidden bg-white rounded-2xl flex items-center justify-center text-4xl`} style={{ transform: "rotateY(0deg)" }}>
                        <span>{card.emoji}</span>
                      </div>

                      {/* 뒷면 */}
                      <div className={`absolute inset-0 backface-hidden bg-amber-400 rounded-2xl flex items-center justify-center text-2xl text-white`} style={{ transform: "rotateY(180deg)" }}>
                        <span>뒤집기</span>
                      </div>
                    </motion.div>
                  </motion.button>
                );
              })}
            </div>
          </div>
        </main>

        <section className="mt-6 bg-white p-4 rounded-2xl shadow-lg">
          <h3 className="text-xl font-semibold mb-2">최근 성과</h3>
          <div className="text-sm text-amber-700">
            {performanceHistory.length === 0 ? (
              <div>아직 기록이 없습니다. 게임을 시작해 보세요!</div>
            ) : (
              <ul className="space-y-2">
                {performanceHistory.slice().reverse().map((r, i) => (
                  <li key={i} className="p-2 border rounded-lg bg-amber-50">
                    <div>날짜: {new Date(r.timestamp).toLocaleString()}</div>
                    <div>레벨: {r.level} / 성공: {r.success ? '예' : '아니오'}</div>
                    {r.success && <div>시간: {r.timeSec}s / 시도: {r.moves}</div>}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="mt-4 text-sm text-amber-600">힌트: 음성안내를 켜면 더 편리합니다.</div>
        </section>

        <footer className="mt-6 text-center text-xs text-amber-500">
          © 메모리 매칭 게임 — 큰 글씨와 간단한 조작으로 설계되었습니다.
        </footer>
      </div>
    </div>
  );
}
