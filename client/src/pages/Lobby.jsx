// src/pages/Lobby.jsx
import React from 'react';
import { useSocket } from '../context/SocketContext';
import { useParams } from 'react-router-dom';
import '../App.css'; // Use the main stylesheet

function Lobby() {
    // Get everything from the context
    const { socket, clientId, lobbyState, leaveLobby } = useSocket();
    const { lobbyId } = useParams(); // Get lobbyId from URL

    // We no longer need useEffect for listeners, the context handles it!
    
    const isHost = lobbyState?.hostId === clientId;

    const handleChangeTeam = (team) => {
        socket.send(JSON.stringify({ type: 'client_change_team', team: team }));
    };

    const handleStartGame = () => {
        socket.send(JSON.stringify({ type: 'client_start_game' }));
    };

    // If context has no lobby state, something is wrong (e.g. direct URL nav)
    if (!lobbyState || lobbyState.lobbyId !== lobbyId) {
        return <div className="home-container">
            <h1>Loading Lobby...</h1>
            <p>If you are not redirected, <a href="/">go home</a>.</p>
        </div>;
    }

    const { players, mode, maxPlayers } = lobbyState;
    const teamBlue = Object.entries(players).filter(([, p]) => p.team === 'blue');
    const teamRed = Object.entries(players).filter(([, p]) => p.team === 'red');
    const teamSize = maxPlayers / 2;

    const renderPlayerSlots = (team, teamName) => {
        const slots = [];
        for (let i = 0; i < teamSize; i++) {
            const player = team[i]; // [clientId, { name, team }]
            if (player) {
                const [pid, pdata] = player;
                slots.push(
                    <div key={pid} className={`lobby-player-slot ${pid === clientId ? 'my-slot' : ''}`}>
                        {pdata.name}
                        {pid === lobbyState.hostId && ' (Host)'}
                    </div>
                );
            } else {
                slots.push(<div key={`empty-${teamName}-${i}`} className="lobby-player-slot empty">(Empty)</div>);
            }
        }
        return slots;
    };

    return (
        <div className="home-container lobby-container">
            <h1>Lobby: {lobbyId}</h1>
            <p>Mode: <strong>{mode}</strong> | Players: {Object.keys(players).length} / {maxPlayers}</p>
            
            <div className="lobby-teams">
                <div className="lobby-team team-blue">
                    <h2>Blue Team</h2>
                    {renderPlayerSlots(teamBlue, 'blue')}
                    <button onClick={() => handleChangeTeam('blue')} className="team-button">Join Blue</button>
                </div>
                <div className="lobby-team team-red">
                    <h2>Red Team</h2>
                    {renderPlayerSlots(teamRed, 'red')}
                    <button onClick={() => handleChangeTeam('red')} className="team-button">Join Red</button>
                </div>
            </div>

            {isHost ? (
                <button onClick={handleStartGame} className="start-game-button">Start Game</button>
            ) : (
                <p>Waiting for host to start the game...</p>
            )}
             {/* Use the new leaveLobby function from context */}
             <button onClick={leaveLobby} style={{marginTop: '1rem'}}>Leave Lobby</button>
        </div>
    );
}

export default Lobby;