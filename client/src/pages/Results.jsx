// src/pages/Results.jsx
import React from 'react';
import { useLocation, Link } from 'react-router-dom';
import '../App.css'; 

function Results() {
  const location = useLocation();
  const { winner, scores, playerStats, mvp } = location.state || {}; 

  if (!winner || !scores || !playerStats) {
    return (
      <div className="home-container">
        <h1>NO DATA</h1>
        <p>Mission logs are empty. Return to base.</p>
        <Link to="/"><button>RETURN HOME</button></Link>
      </div>
    );
  }

  // Sort: MVP first, then by score
  const mvpSort = (a, b) => {
    // If one is MVP, they go first
    if (a.id === mvp) return -1;
    if (b.id === mvp) return 1;
    
    // Otherwise sort by total score
    const scoreA = (a.captures * 100) + (a.tags * 25);
    const scoreB = (b.captures * 100) + (b.tags * 25);
    return scoreB - scoreA;
  };

  const allPlayersWithId = Object.entries(playerStats).map(([id, stats]) => ({
    id, ...stats
  }));

  const blueTeam = allPlayersWithId.filter(p => p.team === 'blue').sort(mvpSort);
  const redTeam = allPlayersWithId.filter(p => p.team === 'red').sort(mvpSort);

  const winnerText = winner === 'blue' ? 'BLUE SQUAD WINS' : 'RED SQUAD WINS';
  const winnerClass = winner === 'blue' ? 'text-blue' : 'text-red';

  const PlayerStatCard = ({ player }) => {
    const isMvp = player.id === mvp;
    return (
      <div className={`stat-card ${isMvp ? 'mvp-card' : ''} ${player.team}-border`}>
        <div className="stat-info">
          <span className="player-name">{player.name}</span>
          {isMvp && <span className="mvp-badge">MVP</span>}
        </div>
        <div className="stat-numbers">
          <div className="stat-box">
            <span className="label">CAPS</span>
            <span className="value">{player.captures}</span>
          </div>
          <div className="stat-box">
            <span className="label">TAGS</span>
            <span className="value">{player.tags}</span>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="results-screen">
      <div className="results-header">
        <p className="subtitle">GAME OVER</p>
        <h1 className={`winner-title ${winnerClass}`}>{winnerText}</h1>
        
        <div className="final-score-display">
          <span className="score-blue">{scores.blue}</span>
          <span className="score-divider">-</span>
          <span className="score-red">{scores.red}</span>
        </div>
      </div>
      
      <div className="stats-grid-container">
        <div className="team-stats-column">
          <h2 className="column-title blue">BLUE TEAM</h2>
          {blueTeam.map(player => (
            <PlayerStatCard key={player.id} player={player} />
          ))}
        </div>
        
        <div className="center-divider"></div>

        <div className="team-stats-column">
          <h2 className="column-title red">RED TEAM</h2>
          {redTeam.map(player => (
            <PlayerStatCard key={player.id} player={player} />
          ))}
        </div>
      </div>
      
      <div className="results-actions">
        <Link to="/">
          <button className="play-again-btn">PLAY AGAIN</button>
        </Link>
      </div>
    </div>
  );
}

export default Results;