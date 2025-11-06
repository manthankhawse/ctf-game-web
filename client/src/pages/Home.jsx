// ctf-client/src/pages/Home.jsx
import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import '../App.css'; 

function Home() {
  const navigate = useNavigate();

  const handleStartGame = (mode) => {
    // Use navigate state to pass the selected mode to the Game component
    navigate('/game', { state: { mode: mode } });
  };

  return (
    <div className="home-container">
      <h1>Capture the Flag</h1>
      <p>A fast-paced WebRTC game.</p>
      
      <div className="menu-buttons">
        <button onClick={() => handleStartGame('1v1')}>
          Start 1v1 Game
        </button>
        <button onClick={() => handleStartGame('2v2')}>
          Start 2v2 Game
        </button>
        <button onClick={() => handleStartGame('3v3')}>
          Start 3v3 Game
        </button>
        
        <Link to="/instructions">
          <button className="secondary">How to Play</button>
        </Link>
      </div>
    </div>
  );
}

export default Home;