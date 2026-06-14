require('dotenv').config();

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const session = require('express-session');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Configurar sesiones
app.use(session({
    secret: 'mundial2026secreto',
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: 1000 * 60 * 60 * 24 }
}));

// CREDENCIALES DESDE .env
const USUARIOS = {
    [process.env.ADMIN_USER]: process.env.ADMIN_PASS,
    [process.env.USER_USER]: process.env.USER_PASS
};

const DATA_FILE = path.join(__dirname, 'datos.json');

let datosPartidos = {
    partidos: [],
    grupos: {},
    noticias: [],
    predicciones: {},
    ultimaActualizacion: new Date(),
    estadisticas: {
        totalJugados: 0,
        totalEnVivo: 0,
        totalProximos: 80
    }
};

function guardarDatos() {
    fs.writeFileSync(DATA_FILE, JSON.stringify(datosPartidos, null, 2));
}

function inicializarDatos() {
    if (!fs.existsSync(DATA_FILE)) {
        fs.writeFileSync(DATA_FILE, JSON.stringify(datosPartidos, null, 2));
    } else {
        datosPartidos = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    }
}

// MIDDLEWARE DE AUTENTICACIÓN
function verificarLogin(req, res, next) {
    if (req.session.usuario) {
        next();
    } else {
        res.status(401).json({ error: 'No autenticado' });
    }
}

// ============ RUTAS DE AUTENTICACIÓN ============
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/api/login', (req, res) => {
    const { usuario, password } = req.body;
    if (USUARIOS[usuario] && USUARIOS[usuario] === password) {
        req.session.usuario = usuario;
        res.json({ success: true, mensaje: 'Bienvenido ' + usuario, usuario });
    } else {
        res.status(401).json({ success: false, error: 'Usuario o contraseña incorrectos' });
    }
});

app.get('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true, mensaje: 'Sesión cerrada' });
});

app.get('/api/session', (req, res) => {
    if (req.session.usuario) {
        res.json({ autenticado: true, usuario: req.session.usuario });
    } else {
        res.json({ autenticado: false });
    }
});

// ============ RUTAS DE API ============
app.get('/api/partidos', verificarLogin, (req, res) => {
    res.json(datosPartidos.partidos);
});

app.get('/api/grupos', verificarLogin, (req, res) => {
    res.json(datosPartidos.grupos);
});

app.get('/api/grupos/:grupo', verificarLogin, (req, res) => {
    const grupo = req.params.grupo.toUpperCase();
    const equipos = datosPartidos.grupos[grupo] || {};
    const ordenados = Object.entries(equipos)
        .map(([equipo, stats]) => ({ equipo, ...stats }))
        .sort((a, b) => {
            if (b.pts !== a.pts) return b.pts - a.pts;
            return (b.gf - b.gc) - (a.gf - a.gc);
        });
    res.json(ordenados);
});

app.post('/api/partidos/:id', verificarLogin, (req, res) => {
    const id = parseInt(req.params.id);
    const { goles1, goles2 } = req.body;
    const partido = datosPartidos.partidos.find(p => p.id === id);
    if (!partido) return res.status(404).json({ error: 'Partido no encontrado' });
    partido.goles1 = goles1;
    partido.goles2 = goles2;
    partido.resultado = `${goles1}-${goles2}`;
    partido.estado = 'jugado';
    if (goles1 > goles2) {
        partido.fortalezaE1 *= 1 + (goles1 * 0.08);
        partido.fortalezaE2 *= 1 - (goles1 * 0.03);
    } else if (goles2 > goles1) {
        partido.fortalezaE2 *= 1 + (goles2 * 0.08);
        partido.fortalezaE1 *= 1 - (goles2 * 0.03);
    } else {
        partido.fortalezaE1 *= 1.02;
        partido.fortalezaE2 *= 1.02;
    }
    const { equipo1, equipo2, grupo } = partido;
    const stats1 = datosPartidos.grupos[grupo][equipo1];
    const stats2 = datosPartidos.grupos[grupo][equipo2];
    stats1.pj++; stats2.pj++;
    stats1.gf += goles1; stats1.gc += goles2;
    stats2.gf += goles2; stats2.gc += goles1;
    stats1.dg = stats1.gf - stats1.gc;
    stats2.dg = stats2.gf - stats2.gc;
    if (goles1 > goles2) { stats1.pg++; stats1.pts += 3; stats2.pp++; }
    else if (goles2 > goles1) { stats2.pg++; stats2.pts += 3; stats1.pp++; }
    else { stats1.pe++; stats1.pts += 1; stats2.pe++; stats2.pts += 1; }
    const jugados = datosPartidos.partidos.filter(p => p.estado === 'jugado').length;
    const proximos = datosPartidos.partidos.filter(p => p.estado === 'proximo').length;
    datosPartidos.estadisticas.totalJugados = jugados;
    datosPartidos.estadisticas.totalProximos = proximos;
    datosPartidos.ultimaActualizacion = new Date();
    guardarDatos();
    res.json({ mensaje: 'Resultado actualizado', partido });
});

app.get('/api/estadisticas', verificarLogin, (req, res) => {
    const jugados = datosPartidos.partidos.filter(p => p.estado === 'jugado').length;
    const enVivo = datosPartidos.partidos.filter(p => p.estado === 'en-vivo').length;
    const proximos = datosPartidos.partidos.filter(p => p.estado === 'proximo').length;
    res.json({ totalJugados: jugados, totalEnVivo: enVivo, totalProximos: proximos, total: datosPartidos.partidos.length, ultimaActualizacion: datosPartidos.ultimaActualizacion });
});

app.get('/api/noticias', verificarLogin, async (req, res) => {
    const noticias = [
        { fuente: 'ESPN', titulo: 'Últimas noticias del Mundial 2026', descripcion: 'Seguimiento en vivo de todos los partidos', url: 'https://www.espn.com/soccer/', fecha: new Date(), categoria: 'resultados' },
        { fuente: 'Goal.com', titulo: 'Análisis del equipo argentino en el Mundial', descripcion: 'Argentina busca defender su título', url: 'https://www.goal.com', fecha: new Date(), categoria: 'análisis' },
        { fuente: 'BBC Sport', titulo: 'Inglaterra lista para el Mundial 2026', descripcion: 'El equipo de Tuchel viaja a América del Norte', url: 'https://www.bbc.com/sport/football', fecha: new Date(), categoria: 'equipos' }
    ];
    res.json(noticias);
});

app.get('/api/predicciones', verificarLogin, (req, res) => {
    const predicciones = {};
    const grupos = ['A','B','C','D','E','F','G','H','I','J','K','L'];
    grupos.forEach(grupo => {
        const equipos = datosPartidos.grupos[grupo] || {};
        const equiposOrdenados = Object.entries(equipos)
            .map(([equipo, pts]) => ({equipo, pts}))
            .sort((a,b) => b.pts - a.pts);
        predicciones[grupo] = {
            primero: equiposOrdenados[0]?.equipo || 'Por definir',
            probPrimero: equiposOrdenados[0]?.pts > 0 ? 85 : 50,
            segundo: equiposOrdenados[1]?.equipo || 'Por definir',
            probSegundo: equiposOrdenados[1]?.pts > 0 ? 75 : 40
        };
    });
    res.json(predicciones);
});

app.get('/', (req, res) => {
    if (req.session.usuario) {
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    } else {
        res.redirect('/login');
    }
});

app.listen(PORT, () => {
    inicializarDatos();
    console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
    console.log(`🔐 Login en http://localhost:${PORT}/login`);
    console.log(`\n👤 Credenciales:\n   Usuario: ${process.env.ADMIN_USER}\n   Contraseña: ${process.env.ADMIN_PASS}`);
});
