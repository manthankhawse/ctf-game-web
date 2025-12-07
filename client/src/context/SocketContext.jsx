// src/context/SocketContext.jsx
import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

const SocketContext = createContext();

export const useSocket = () => useContext(SocketContext);

const getSocketUrl = () => {
    // 1. Check if we are being redirected
    const redirectUrl = sessionStorage.getItem('redirectUrl');
    if (redirectUrl) {
        sessionStorage.removeItem('redirectUrl'); // Use it once
        return redirectUrl;
    }
    
    // 2. Check for a query parameter
    const params = new URLSearchParams(window.location.search);
    const serverPort = params.get('server'); // e.g., "3001"
    if (serverPort) {
        console.log(`Connecting to server from URL param: ${serverPort}`);
        // return `ws://10.205.223.130:${serverPort}`;
        return `ws://localhost:${serverPort}`;
    }

    // 3. Default to port 3000
    // return 'ws://10.205.223.130:3000';
    return `ws://localhost:3000`;
}

export const SocketProvider = ({ children }) => {
    const [socket, setSocket] = useState(null);
    const [clientId, setClientId] = useState(null);
    const [playerName, setPlayerName] = useState(localStorage.getItem('playerName') || '');
    const [lobbyState, setLobbyState] = useState(null);
    
    const navigate = useNavigate();
    const messageListenersRef = useRef(new Map());

    useEffect(() => {
        const wsUrl = getSocketUrl();
        const ws = new WebSocket(wsUrl);

        ws.onopen = () => {
            console.log('Global WebSocket connected to', ws.url);
            setSocket(ws);
        };
        
        ws.onclose = () => {
            console.log('Global WebSocket disconnected from', ws.url);
            setSocket(null);
            setLobbyState(null);
            
            if (sessionStorage.getItem('isRedirecting') === 'true') {
                sessionStorage.removeItem('isRedirecting');
            } else {
                alert('Connection to server lost. Returning home.');
                navigate('/');
            }
        };

        ws.onmessage = (event) => {
            const message = JSON.parse(event.data);

            messageListenersRef.current.forEach((listener, type) => {
                if (type === message.type || type === 'all') {
                    listener(message);
                }
            });

            switch (message.type) {
                // --- server_client_id (FIXED) ---
                case 'server_client_id':
                    setClientId(message.clientId);
                    console.log('Got client ID:', message.clientId);
                    
                    const autoJoinLobbyId = sessionStorage.getItem('autoJoinLobbyId');
                    const oldClientId = sessionStorage.getItem('oldClientId'); // <-- FIX: Get old ID
                    
                    // Send name AND auto-join request in one go
                    ws.send(JSON.stringify({ 
                        type: 'client_set_name', 
                        name: playerName,
                        autoJoinLobbyId: autoJoinLobbyId || null, // Send the ID or null
                        oldClientId: oldClientId || null // <-- FIX: Send old ID or null
                    }));
                    
                    if (autoJoinLobbyId) {
                        sessionStorage.removeItem('autoJoinLobbyId');
                        console.log('Requested auto-join for lobby:', autoJoinLobbyId);
                    }
                    if (oldClientId) { // <-- FIX: Clean up old ID
                        sessionStorage.removeItem('oldClientId');
                    }
                    break;
                
                case 'server_lobby_created':
                case 'server_lobby_joined':
                case 'server_lobby_update':
                    console.log('Context updating lobby state:', message.lobbyState);
                    setLobbyState(message.lobbyState);
                    if (message.type === 'server_lobby_joined') {
                        navigate(`/lobby/${message.lobbyState.lobbyId}`);
                    }
                    break;

                case 'server_game_starting':
                    console.log('Context saw game starting, navigating...');
                    setLobbyState(message.lobby); 
                    navigate('/game');
                    break;
                
                // --- server_redirect (FIXED) ---
                case 'server_redirect':
                    console.log(`Redirecting to ${message.url} for lobby ${message.lobbyId}`);
                    sessionStorage.setItem('redirectUrl', message.url);
                    sessionStorage.setItem('autoJoinLobbyId', message.lobbyId);
                    if (message.oldClientId) { // <-- FIX: Store old ID
                        sessionStorage.setItem('oldClientId', message.oldClientId);
                    }
                    sessionStorage.setItem('isRedirecting', 'true');
                    
                    window.location.reload(); // Force a full page reload
                    break;

                case 'error':
                    console.error('Server error:', message.message);
                    alert(`Error: ${message.message}`);
                    break;
                default:
                    break;
            }
        };

        return () => {
            ws.close();
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []); // Runs ONCE.

    const addSocketListener = (type, callback) => {
        messageListenersRef.current.set(type, callback);
    };
    const removeSocketListener = (type) => {
        messageListenersRef.current.delete(type);
    };
    const updatePlayerName = (name) => {
        const trimmedName = name.substring(0, 15);
        setPlayerName(trimmedName);
        localStorage.setItem('playerName', trimmedName);
        if (socket && socket.readyState === WebSocket.OPEN) {
            // Send name update *without* an auto-join request
            socket.send(JSON.stringify({ 
                type: 'client_set_name', 
                name: trimmedName,
                autoJoinLobbyId: null,
                oldClientId: null
            }));
        }
    };
    const leaveLobby = () => {
        setLobbyState(null);
        navigate('/');
    };
    const value = {
        socket,
        clientId,
        playerName,
        lobbyState,
        updatePlayerName,
        addSocketListener,
        removeSocketListener,
        leaveLobby,
    };
    return (
        <SocketContext.Provider value={value}>
            {children}
        </SocketContext.Provider>
    );
};