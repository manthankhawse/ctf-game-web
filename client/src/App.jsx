// ctf-client/src/App.js
import React from 'react';
import { Routes, Route } from 'react-router-dom';
import Home from './pages/Home';
import Game from './pages/Game';
import Instructions from './pages/Instructions';
// We can add a Results page later
// import Results from './pages/Results';
import './App.css';

function App() {
  return (
    <div className="App">
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/game" element={<Game />} />
        <Route path="/instructions" element={<Instructions />} />
        {/* <Route path="/results" element={<Results />} /> */}
      </Routes>
    </div>
  );
}

export default App;