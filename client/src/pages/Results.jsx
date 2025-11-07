// ctf-client/src/pages/Results.jsx
import React from 'react';
import { useLocation, Link } from 'react-router-dom';
import '../App.css'; // Use the main stylesheet

function Results() {
  const location = useLocation();
  // Get all data passed from the Game page
  const { winner, scores, playerStats, mvp } = location.state || {}; 

  // Handle case where user navigates here directly
  if (!winner || !scores || !playerStats) {
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

  // Process players into sorted team lists
  const allPlayersWithId = Object.entries(playerStats).map(([id, stats]) => ({
    id: id, // id is 'blue1', 'red2', etc.
    ...stats
  }));

  // Sort by MVP score (captures * 100 + tags * 25)
  const mvpSort = (a, b) => {
    const scoreA = (a.captures * 100) + (a.tags * 25);
    const scoreB = (b.captures * 100) + (b.tags * 25);
    return scoreB - scoreA;
  };

  const blueTeam = allPlayersWithId.filter(p => p.team === 'blue').sort(mvpSort);
  const redTeam = allPlayersWithId.filter(p => p.team === 'red').sort(mvpSort);

  const winnerColor = winner === 'blue' ? '#3498db' : '#e74c3c';

  // Helper component to render a player card
  const PlayerStatCard = ({ player }) => {
    const isMvp = player.id === mvp;
    return (
      <div className={`player-stat-card ${isMvp ? 'mvp' : ''}`}>
        <div className="player-stat-name">
          {player.name}
          {isMvp && <span className="mvp-badge">MVP</span>}
        </div>
        <div className="player-stat-scores">
          <span>Captures: <strong>{player.captures}</strong></span>
          <span>Tags: <strong>{player.tags}</strong></span>
        </div>
      </div>
    );
  };

  return (
    <div className="home-container results-container">
      <h1 style={{ color: winnerColor, fontSize: '3rem', margin: 0 }}>
        {winner.toUpperCase()} TEAM WINS!
      </h1>
      
      <div className="results-scores-final">
        <span className="team-blue-score">{scores.blue}</span>
        <span className="score-divider">-</span>
        <span className="team-red-score">{scores.red}</span>
      </div>
      
      <div className="results-scoreboard-container">
        <div className="results-team-list team-blue">
          <h2>Blue Team</h2>
          {blueTeam.map(player => (
            <PlayerStatCard key={player.id} player={player} />
          ))}
        </div>
        <div className="results-team-list team-red">
          <h2>Red Team</h2>
          {redTeam.map(player => (
            <PlayerStatCard key={player.id} player={player} />
          ))}
        </div>
      </div>
      
      <Link to="/">
        <button>Play Again</button>
      </Link>
    </div>
  );
}

export default Results;