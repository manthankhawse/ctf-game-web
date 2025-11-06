// ctf-client/src/pages/Instructions.jsx
import React from 'react';
import { Link } from 'react-router-dom';
import '../App.css';

function Instructions() {
  return (
    <div className="instructions-container">
      <h1>How to Play</h1>
      
      <div className="instructions-content">
        <p><strong>Goal:</strong> Capture the enemy's flag and return it to your base to score.</p>
        <p>The first team to {3} points wins!</p> {/* Use your WIN_SCORE const */}
        
        <h2>Controls</h2>
        <ul>
          <li><strong>Move:</strong> Use WASD or the Arrow Keys to move your player.</li>
        </ul>

        <h2>Gameplay</h2>
        <ul>
          <li>Run over the enemy flag (Red 🟥 or Blue 🟦) to pick it up.</li>
          <li>Return to your own base (the colored zone) to score a point.</li>
          <li>If you are carrying the flag and an enemy player tags you, the flag is returned to their base.</li>
        </ul>
      </div>
      
      <Link to="/">
        <button>Back to Home</button>
      </Link>
    </div>
  );
}

export default Instructions;