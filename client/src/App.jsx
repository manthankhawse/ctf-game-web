// src/App.jsx
import React from 'react';
import { Routes, Route } from 'react-router-dom';
import { SocketProvider } from './context/SocketContext'; // <-- IMPORT
import Home from './pages/Home';
import Lobby from './pages/Lobby'; // <-- IMPORT
import Game from './pages/Game';
import Instructions from './pages/Instructions';
import Results from './pages/Results';
import './App.css';

function App() {
  return (
    // Wrap everything in the SocketProvider
    <SocketProvider>
      <div className="App">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/lobby/:lobbyId" element={<Lobby />} /> {/* <-- NEW ROUTE */}
          <Route path="/game" element={<Game />} />
          <Route path="/instructions" element={<Instructions />} />
          <Route path="/results" element={<Results />} />
        </Routes>
      </div>
    </SocketProvider>
  );
}

export default App;