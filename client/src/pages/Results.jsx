// ctf-client/src/pages/Results.jsx
import React from 'react';
import { useLocation, Link } from 'react-router-dom';
import '../App.css'; // Use the main stylesheet

function Results() {
  const location = useLocation();
  // Get data passed from the Game page
  const { winner, scores } = location.state || {}; 

  // Handle case where user navigates here directly
  if (!winner || !scores) {
    return (
      <div className="home-container">
        <h1>No Results</h1>
        <p>You must play a game to see the results.</p>
        <Link to="/">
          <button>Back to Home</button>
        </Link>
      </div>
    );
  }

  const winnerColor = winner === 'blue' ? '#3498db' : '#e74c3c';

  return (
    <div className="home-container">
      <h1 style={{ color: winnerColor, fontSize: '3rem' }}>
        {winner.toUpperCase()} TEAM WINS!
      </h1>
      
      <div className="results-scores" style={{ margin: '2rem 0' }}>
        <h2>Final Score</h2>
        <p style={{ fontSize: '1.5rem', color: '#3498db' }}>
          Blue: <span style={{ fontWeight: 'bold' }}>{scores.blue}</span>
        </p>
        <p style={{ fontSize: '1.5rem', color: '#e74c3c' }}>
          Red: <span style={{ fontWeight: 'bold' }}>{scores.red}</span>
        </p>
      </div>
      
      {/* We can add MVP and Leaderboard here later */}
      
      <Link to="/">
        <button>Play Again</button>
      </Link>
    </div>
  );
}

export default Results;