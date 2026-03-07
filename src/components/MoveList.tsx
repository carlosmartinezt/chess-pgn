interface Props {
  moves: string[];
  selectedIndex: number | null;
  onMoveClick: (index: number) => void;
}

export function MoveList({ moves, selectedIndex, onMoveClick }: Props) {
  if (moves.length === 0) {
    return <pre id="pgn-output">(no verified moves yet)</pre>;
  }

  return (
    <pre id="pgn-output">
      <div className="moves-list">
        {moves.map((move, i) => (
          <span key={i}>
            {i % 2 === 0 && <span className="move-number">{Math.floor(i / 2) + 1}.</span>}
            <button
              className={`move-btn${i === selectedIndex ? " selected" : ""}`}
              onClick={() => onMoveClick(i)}
            >
              {move}
            </button>
          </span>
        ))}
      </div>
    </pre>
  );
}
