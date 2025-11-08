\# Capture the Flag: Horizontally Scalable Real-Time Multiplayer System



A high-performance, real-time multiplayer "Capture the Flag" game built with a distributed, horizontally scalable Node.js architecture.

It features low-latency WebRTC communication for both voice and gameplay, CPU-isolated game simulations, and Redis-based inter-server coordination.



---



\## 🚀 Key Highlights



\* \*\*Horizontal Scalability:\*\*

&nbsp; Multiple Node.js servers can run in parallel, each capable of hosting independent game instances. Load is dynamically distributed to the least busy server.



\* \*\*CPU-Isolated Game Logic:\*\*

&nbsp; Each game runs in its own dedicated `worker\_thread`, preventing any single CPU-bound simulation from blocking the main event loop.



\* \*\*Real-Time Voice \& Game Communication:\*\*

&nbsp; Uses WebRTC for both audio (P2P voice chat) and `RTCDataChannel` for UDP-based game state synchronization, ensuring low latency.



\* \*\*Centralized Coordination with Redis:\*\*

&nbsp; Redis manages live server discovery, load tracking, lobby synchronization, and inter-server event broadcasting.



\* \*\*Dynamic Matchmaking \& Redirects:\*\*

&nbsp; The matchmaking system automatically routes new players to available or least-loaded servers, ensuring even distribution and seamless scaling.



---



\## ⚙️ System Architecture Overview



The system is designed to overcome Node.js’s single-thread limitation by distributing both \*\*connections\*\* and \*\*game computations\*\* across multiple processes.



\### Components



\* \*\*`server.js` (Main Thread):\*\*

&nbsp; Handles player connections, matchmaking, lobby creation, and game orchestration. Each instance runs independently on a unique port.



\* \*\*Redis Cluster:\*\*

&nbsp; Provides a shared communication and coordination layer between servers.



&nbsp; \* \*\*Pub/Sub Channels:\*\* For heartbeats, lobby creation/removal, and state updates.

&nbsp; \* \*\*Shared Cache:\*\* Tracks the load and status of all active servers.



\* \*\*`game.worker.js` (Worker Thread):\*\*

&nbsp; A self-contained simulation environment for each active game. It runs on a separate thread to isolate CPU-heavy operations from the main server process.



\### Load Distribution Flow



1\. \*\*Server Registration:\*\*

&nbsp;  Each server instance publishes a periodic heartbeat (with its load metrics) to Redis. All servers subscribe to updates to maintain an up-to-date view of the cluster.



2\. \*\*Player Connection:\*\*

&nbsp;  Players connect to any server endpoint via WebSocket. The chosen entry point acts as a lightweight router for matchmaking.



3\. \*\*Lobby Creation:\*\*

&nbsp;  When a new lobby is needed, the system determines the least-loaded server using the shared Redis state and assigns the lobby there.



4\. \*\*Seamless Redirection:\*\*

&nbsp;  If the assigned lobby resides on a different server, the client automatically reconnects to that server via a redirect event, preserving its session state.



5\. \*\*Game Execution:\*\*

&nbsp;  The hosting server spawns a worker thread for the match. The worker runs the simulation loop and communicates results back to the main process through message passing.



6\. \*\*State Cleanup:\*\*

&nbsp;  When the match ends, the worker terminates, and the hosting server updates Redis with its reduced load.



This architecture allows infinite horizontal scaling—simply start additional server instances to expand capacity.



---



\## 🧩 Technology Stack



\### Backend



\* \*\*Node.js:\*\* Core runtime environment for scalable I/O and multithreading.

\* \*\*WebSockets (`ws`):\*\* For signaling, matchmaking, and general event communication.

\* \*\*Redis (`ioredis`):\*\* Distributed synchronization via Pub/Sub and caching.

\* \*\*Worker Threads:\*\* For isolating simulation-heavy computations.

\* \*\*Werift (WebRTC for Node.js):\*\* Server-side WebRTC support for peer communication.



\### Frontend



\* \*\*React:\*\* Client-side UI with dynamic state management.

\* \*\*React Router:\*\* Navigation and routing control.

\* \*\*Socket Context (React Context):\*\* Manages WebSocket connections, redirects, and auto-join states.

\* \*\*Browser WebRTC APIs:\*\* For direct voice and game data exchange via P2P connections.



---



\## 🧠 Example: Player Flow Across Servers



1\. \*\*Servers Start:\*\*

&nbsp;  Multiple servers (e.g., ports 3000–3002) launch and register with Redis via heartbeats.



2\. \*\*Player A Joins:\*\*

&nbsp;  Connects to server `3000`, creates a public lobby (`Lobby A`).



3\. \*\*Player B Joins:\*\*

&nbsp;  Connects to the same server and joins `Lobby A`.



4\. \*\*Game 1 Starts:\*\*

&nbsp;  Server `3000` spawns a worker thread to run the game logic for `Lobby A`.



5\. \*\*Player C Joins:\*\*

&nbsp;  The matchmaking system detects that server `3000` has higher load and redirects C to server `3001`, where `Lobby B` is created.



6\. \*\*Player D Joins:\*\*

&nbsp;  Redirected to the same server to complete `Lobby B`.



&nbsp;  \* Game 2 starts on a worker thread on server `3001`.



\*\*Result:\*\*

Game 1 runs on server `3000`, Game 2 runs on server `3001`—demonstrating true horizontal load distribution.



---



\## 🧰 Local Setup



\### Prerequisites



\* Node.js v16 or higher

\* Redis (running locally on port `6379`)

\* npm



\### 1. Clone \& Install



```bash

git clone https://github.com/your-username/your-repo-name.git

cd your-repo-name

npm install

```



\### 2. Setup Frontend



```bash

cd client

npm install

```



\### 3. Run Multiple Servers



Open multiple terminals and run:



```bash

PORT=3000 node server.js

PORT=3001 node server.js

PORT=3002 node server.js

```



\### 4. Start the Client



```bash

cd client

npm start

```



---



\## 🧪 Testing Load Balancing



1\. Open `http://localhost:5173` in your browser.

2\. Join a match with two players — Game 1 will start on Server 3000.

3\. Open a second browser/incognito window, join another match — players will be redirected to Server 3001.

4\. Observe terminal logs for live server load updates and redirections.



---



\## 📈 Scalability Benefits



\* Each additional Node.js instance adds linear scalability.

\* Redis ensures consistent state across all servers.

\* CPU-intensive simulations never block network I/O.

\* WebRTC ensures real-time performance with minimal latency.



