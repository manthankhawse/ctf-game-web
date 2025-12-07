// src/pages/Instructions.jsx
import React from 'react';
import { Link } from 'react-router-dom';
import '../App.css';

function Instructions() {
  return (
    <div className="home-container instructions-panel">
      <header>
          <h1>MISSION PROTOCOLS</h1>
          <p className="subtitle">CLASSIFIED INTEL // EYES ONLY</p>
      </header>
      
      <div className="instructions-grid">
        <section className="instruction-card">
          <h2 className="section-title">PRIMARY OBJECTIVE</h2>
          <div className="content-block">
            <p>Infiltrate the enemy sector. Seize their <span className="highlight-text">FLAG MODULE</span>.</p>
            <p>Return the asset to your <span className="highlight-base">HOME BASE</span> to score.</p>
            <div className="goal-box">
              <span>VICTORY CONDITION:</span>
              <strong>3 CAPTURES</strong>
            </div>
          </div>
        </section>

        <section className="instruction-card">
          <h2 className="section-title">NAVIGATION</h2>
          <div className="controls-layout">
            <div className="key-group">
              <div className="key">W</div>
              <div className="key-row">
                <div className="key">A</div>
                <div className="key">S</div>
                <div className="key">D</div>
              </div>
            </div>
            <p>MOVEMENT CONTROLS</p>
          </div>
        </section>

        <section className="instruction-card full-width">
          <h2 className="section-title">TACTICAL RULES</h2>
          <ul className="tactical-list">
            <li>
              <span className="bullet">►</span>
              <span><strong>ACQUISITION:</strong> Move over the enemy flag to secure it.</span>
            </li>
            <li>
              <span className="bullet">►</span>
              <span><strong>SCORING:</strong> You must return to your colored base zone to upload the capture.</span>
            </li>
            <li>
              <span className="bullet">►</span>
              <span><strong>NEUTRALIZATION:</strong> If you are tagged by an enemy while carrying the flag, the asset resets instantly.</span>
            </li>
          </ul>
        </section>
      </div>
      
      <div className="action-footer">
        <Link to="/">
          <button className="back-btn">ACKNOWLEDGE & RETURN</button>
        </Link>
      </div>
    </div>
  );
}

export default Instructions;