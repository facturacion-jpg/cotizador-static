import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import Cotizador, { configurarFirestore, configurarLocal, modoAlmacenamiento } from './cotizador/index.js';
import { firebaseConfig, firebaseListo, adminDefinido, ADMIN_UID } from './firebaseConfig.js';
import './styles.css';

const root = createRoot(document.getElementById('root'));

function Pantalla({ children, modo, uid, admin }) {
  const [copiado, setCopiado] = useState(false);
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(uid || '');
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch (_) {
      setCopiado(false);
    }
  };

  return (
    <>
      {children}
      {uid && (
        <details className="ctz-sesion">
          <summary>Información de sesión</summary>
          <p>
            Modo: <strong>{modo === 'firestore' ? 'Firestore' : 'local (este navegador)'}</strong>
            {' · '}ID: <code>{uid}</code>
            {' '}
            <button type="button" onClick={copiar}>{copiado ? 'Copiado' : 'Copiar ID'}</button>
          </p>
          <p>
            {admin ? 'Este dispositivo tiene permisos de administrador.' :
              'Este dispositivo puede cotizar y descargar el historial.'}
            {modo === 'firestore' && !adminDefinido &&
              ' Para habilitar administrador, pegue este ID en VITE_ADMIN_UID y en firestore.rules.'}
            {modo === 'firestore' && adminDefinido && ADMIN_UID !== uid &&
              ` El administrador configurado es ${ADMIN_UID}.`}
          </p>
        </details>
      )}
    </>
  );
}

function mostrar({ usuario, admin, uid }) {
  const modo = modoAlmacenamiento();
  root.render(
    <Pantalla modo={modo} uid={uid} admin={admin}>
      <Cotizador usuario={usuario} admin={admin} />
    </Pantalla>
  );
}

async function arrancar() {
  if (!firebaseListo) {
    // Sin Firebase configurado: funciona de una vez en el navegador.
    configurarLocal();
    mostrar({ usuario: { email: 'usuario-local' }, admin: true, uid: 'local' });
    return;
  }

  try {
    const [{ initializeApp }, authMod, { getFirestore }] = await Promise.all([
      import('firebase/app'),
      import('firebase/auth'),
      import('firebase/firestore')
    ]);
    const app = initializeApp(firebaseConfig);
    const auth = authMod.getAuth(app);
    await authMod.setPersistence(auth, authMod.browserLocalPersistence);

    let user = auth.currentUser;
    if (!user) {
      const credencial = await authMod.signInAnonymously(auth);
      user = credencial.user;
    }

    configurarFirestore(getFirestore(app));
    mostrar({
      usuario: { email: 'anonimo-' + user.uid.slice(0, 8), uid: user.uid },
      admin: user.uid === ADMIN_UID,
      uid: user.uid
    });
  } catch (error) {
    root.render(
      <div className="ctz-error-inicio">
        <h2>No se pudo iniciar Firebase</h2>
        <p>{error && error.message ? error.message : String(error)}</p>
        <p>
          Revise las variables VITE_FIREBASE_* en Render y que el proveedor
          anónimo esté activo en Firebase Authentication.
        </p>
        <button
          type="button"
          onClick={() => {
            configurarLocal();
            mostrar({ usuario: { email: 'usuario-local' }, admin: true, uid: 'local' });
          }}
        >
          Continuar en modo local
        </button>
      </div>
    );
  }
}

arrancar();
