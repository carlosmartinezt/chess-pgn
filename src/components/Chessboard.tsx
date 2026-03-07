import { useRef, useEffect } from "react";
import { Chessground } from "chessground";
import type { Api } from "chessground/api";
import type { Key } from "chessground/types";
import "chessground/assets/chessground.base.css";
import "chessground/assets/chessground.brown.css";
import "chessground/assets/chessground.cburnett.css";

interface LegalMove {
  san: string;
  uci: string;
}

interface Props {
  fen: string;
  orientation: "white" | "black";
  turnColor: "white" | "black";
  legalMoves: LegalMove[];
  highlightSquares?: [Key, Key] | null;
  onMove: (san: string) => void;
}

function toDests(legalMoves: LegalMove[]): Map<Key, Key[]> {
  const dests = new Map<Key, Key[]>();
  for (const m of legalMoves) {
    const from = m.uci.slice(0, 2) as Key;
    const to = m.uci.slice(2, 4) as Key;
    const existing = dests.get(from) || [];
    existing.push(to);
    dests.set(from, existing);
  }
  return dests;
}

export function Chessboard({ fen, orientation, turnColor, legalMoves, highlightSquares, onMove }: Props) {
  const boardRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<Api | null>(null);
  const legalMovesRef = useRef(legalMoves);
  const onMoveRef = useRef(onMove);

  legalMovesRef.current = legalMoves;
  onMoveRef.current = onMove;

  useEffect(() => {
    if (!boardRef.current) return;

    const api = Chessground(boardRef.current, {
      fen,
      orientation,
      turnColor,
      lastMove: highlightSquares || undefined,
      movable: {
        color: turnColor,
        free: false,
        dests: toDests(legalMoves),
      },
      events: {
        move(orig, dest) {
          const uciPrefix = `${orig}${dest}`;
          const match = legalMovesRef.current.find((m) => m.uci.startsWith(uciPrefix));
          if (match) {
            // Check for promotion
            const isPromotion = match.uci.length === 5;
            if (isPromotion) {
              // Default to queen promotion, find the queen variant
              const queenMove = legalMovesRef.current.find(
                (m) => m.uci === `${uciPrefix}q`
              );
              onMoveRef.current(queenMove ? queenMove.san : match.san);
            } else {
              onMoveRef.current(match.san);
            }
          }
        },
      },
    });

    apiRef.current = api;
    return () => api.destroy();
    // Only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update board when props change
  useEffect(() => {
    if (!apiRef.current) return;
    apiRef.current.set({
      fen,
      orientation,
      turnColor,
      lastMove: highlightSquares || undefined,
      movable: {
        color: turnColor,
        free: false,
        dests: toDests(legalMoves),
      },
    });
  }, [fen, orientation, turnColor, legalMoves, highlightSquares]);

  return <div ref={boardRef} className="cg-wrap" />;
}
