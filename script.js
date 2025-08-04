/*
 * DaCapo. client‑side logic using Firebase Authentication and Firestore
 *
 * This version replaces the localStorage persistence with per‑user
 * storage in Cloud Firestore. Each user has a document under the
 * `users` collection where their repertoire, agenda, materials and
 * links are stored as arrays. Authentication is handled via
 * Firebase Auth (email/password or Google). The application UI
 * remains inaccessible until the user has successfully logged in.
 */

document.addEventListener('DOMContentLoaded', () => {
  // Firebase configuration (provided with the task)
  const firebaseConfig = {
    apiKey: "AIzaSyBSrAMIeQc4B9lqg0az3FMWaccq96aAb8o",
    authDomain: "dacapo-app-vf-4ab15.firebaseapp.com",
    projectId: "dacapo-app-vf-4ab15",
    storageBucket: "dacapo-app-vf-4ab15.firebasestorage.app",
    messagingSenderId: "1020500840592",
    appId: "1:1020500840592:web:ff1742b1d0c56e60a00815",
    measurementId: "G-JLKXXSVQVM"
  };

  // Initialise Firebase if not already initialised
  if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
  }
  const auth = firebase.auth();
  const db = firebase.firestore();

  // UI references for authentication and main application
  const authSection = document.getElementById('auth-section');
  const appMain = document.getElementById('app');
  const navBar = document.querySelector('nav');
  const loginForm = document.getElementById('login-form');
  const signupForm = document.getElementById('signup-form');
  const toggleAuthLink = document.getElementById('toggle-auth-link');
  const authError = document.getElementById('auth-error');
  // Gestion du mode sombre : lire l’état enregistré et appliquer la classe
  const darkModeToggleEl = document.getElementById('dark-mode-toggle');
  if (darkModeToggleEl) {
    const savedDark = localStorage.getItem('darkMode');
    if (savedDark === 'true') {
      document.body.classList.add('dark');
      darkModeToggleEl.checked = true;
    }
    darkModeToggleEl.addEventListener('change', () => {
      if (darkModeToggleEl.checked) {
        document.body.classList.add('dark');
        localStorage.setItem('darkMode', 'true');
      } else {
        document.body.classList.remove('dark');
        localStorage.setItem('darkMode', 'false');
      }
    });
  }
  // Le bouton de réglages dans l’en‑tête a été supprimé. Les réglages sont
  // désormais accessibles via un onglet dédié, donc nous ne le
  // sélectionnons plus dans le DOM.
  // const settingsButton = document.getElementById('settings-button');

  // In‑memory state for the current user and their data
  let repertoire = [];
  let agenda = [];
  let materials = [];
  let links = [];
  let userDocRef = null;
  let currentUser = null;
  let appInitialized = false;

  // Helper to escape HTML to prevent injection attacks when rendering
  function escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Utility to update a specific field in Firestore
  function updateFirestoreData(field, data) {
    if (userDocRef) {
      // Use set with merge so that the field is created/updated without overwriting other fields
      userDocRef.set({ [field]: data }, { merge: true }).catch((err) => {
        console.error('Erreur Firestore :', err);
      });
    }
  }

  /*
   * La fenêtre de réglages modale (createSettingsPanel) n’est plus utilisée :
   * les paramètres du compte sont désormais gérés via la page « Réglages ».
   */

  // Create the donation pop‑up overlay
  function createDonationPopup() {
    const overlay = document.createElement('div');
    overlay.id = 'donation-overlay';
    overlay.className = 'modal-overlay';
    overlay.style.display = 'none';
    const panel = document.createElement('div');
    panel.className = 'donation-popup';
    panel.innerHTML = `
      <p>Merci d’utiliser DaCapo. Si vous appréciez l’application, pensez à faire un don symbolique (1‑2 CHF) pour soutenir son développement et les futures mises à jour.</p>
      <button id="close-donation" class="secondary">Fermer</button>
    `;
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    // Close when clicking outside or on the button
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || e.target.id === 'close-donation') {
        overlay.style.display = 'none';
      }
    });
  }
  createDonationPopup();

  // Toggle between login and signup forms
  toggleAuthLink.addEventListener('click', (e) => {
    e.preventDefault();
    if (loginForm.style.display !== 'none') {
      loginForm.style.display = 'none';
      signupForm.style.display = 'flex';
      toggleAuthLink.textContent = 'Déjà un compte ? Connectez‑vous';
    } else {
      signupForm.style.display = 'none';
      loginForm.style.display = 'flex';
      toggleAuthLink.textContent = 'Pas de compte ? Inscrivez‑vous';
    }
    authError.style.display = 'none';
  });

  // Email/password login
  loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    auth.signInWithEmailAndPassword(email, password)
      .catch((err) => {
        authError.textContent = err.message;
        authError.style.display = 'block';
      });
  });

  // Email/password signup
  signupForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = document.getElementById('signup-name').value.trim();
    const email = document.getElementById('signup-email').value.trim();
    const password = document.getElementById('signup-password').value;
    auth.createUserWithEmailAndPassword(email, password)
      .then((cred) => {
        return cred.user.updateProfile({ displayName: name });
      })
      .catch((err) => {
        authError.textContent = err.message;
        authError.style.display = 'block';
      });
  });

  // Google sign‑in has been removed per request.  No event handler is bound.

  // Load data for the authenticated user from Firestore
  async function loadUserData(user) {
    currentUser = user;
    if (!user) return;
    userDocRef = db.collection('users').doc(user.uid);
    try {
      const doc = await userDocRef.get();
      if (!doc.exists) {
        await userDocRef.set({
          name: user.displayName || '',
          email: user.email || '',
          repertoire: [],
          agenda: [],
          materials: [],
          links: []
        });
        repertoire = [];
        agenda = [];
        materials = [];
        links = [];
      } else {
        const data = doc.data();
        repertoire = Array.isArray(data.repertoire) ? data.repertoire : [];
        agenda = Array.isArray(data.agenda) ? data.agenda : [];
        materials = Array.isArray(data.materials) ? data.materials : [];
        links = Array.isArray(data.links) ? data.links : [];
      }
    } catch (err) {
      console.error('Erreur de lecture des données :', err);
      repertoire = [];
      agenda = [];
      materials = [];
      links = [];
    }
    // After data is loaded, initialise UI
    initializeAppUI();
  }

  // Auth state listener: toggles UI and triggers data loading
  auth.onAuthStateChanged((user) => {
    if (user) {
      // Hide auth UI and show app
      authSection.style.display = 'none';
      appMain.style.display = 'block';
      navBar.style.display = 'flex';
      loadUserData(user);
      // Show donation prompt on each login
      const donationOverlay = document.getElementById('donation-overlay');
      if (donationOverlay) {
        donationOverlay.style.display = 'flex';
      }
    } else {
      // Reset state and show auth UI
      currentUser = null;
      userDocRef = null;
      repertoire = [];
      agenda = [];
      materials = [];
      links = [];
      authSection.style.display = 'block';
      appMain.style.display = 'none';
      navBar.style.display = 'none';
    }
  });

  // Attach event to settings button to show/hide settings panel
  settingsButton.addEventListener('click', () => {
    const overlay = document.getElementById('settings-overlay');
    if (!overlay) return;
    if (overlay.style.display === 'none' || overlay.style.display === '') {
      // Prefill fields when opening
      if (currentUser) {
        document.getElementById('profile-name').value = currentUser.displayName || '';
        document.getElementById('profile-email').value = currentUser.email || '';
      }
      overlay.style.display = 'flex';
    } else {
      overlay.style.display = 'none';
    }
  });

  /*
   * Initialise the main application UI after user data has been
   * retrieved. This function binds event listeners only once and
   * renders the current data into the DOM. Subsequent calls will
   * simply refresh the lists without reattaching handlers.
   */
  function initializeAppUI() {
    if (appInitialized) {
      renderRepertoire();
      renderAgenda();
      renderMaterials();
      renderLinks();
      return;
    }
    appInitialized = true;

    // ------ Tab navigation ------
    const navButtons = document.querySelectorAll('nav button');
    const pages = document.querySelectorAll('.page');
    navButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        navButtons.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        const target = btn.dataset.target;
        pages.forEach((page) => {
          if (page.id === target) {
            page.classList.add('active');
          } else {
            page.classList.remove('active');
          }
        });
      });
    });

    // Champ de recherche pour filtrer le répertoire
    const repSearchInput = document.getElementById('rep-search');
    if (repSearchInput) {
      repSearchInput.addEventListener('input', () => {
        renderRepertoire();
      });
    }

    // ------ Répertoire ------
    const repList = document.getElementById('repertoire-list');
    function renderRepertoire() {
      repList.innerHTML = '';
      const groups = { solo: [], chambre: [], orchestre: [] };
      // Appliquer le filtre de recherche si présent
      const searchTerm = repSearchInput && repSearchInput.value ? repSearchInput.value.trim().toLowerCase() : '';
      repertoire.forEach((item, index) => {
        // filtrer par titre ou compositeur
        if (searchTerm) {
          const titleMatch = (item.title || '').toLowerCase().includes(searchTerm);
          const composerMatch = (item.composer || '').toLowerCase().includes(searchTerm);
          if (!titleMatch && !composerMatch) {
            return;
          }
        }
        const cat = item.category && groups.hasOwnProperty(item.category) ? item.category : 'solo';
        groups[cat].push({ ...item, index });
      });
      const categoryNames = { solo: 'Solo', chambre: 'Musique de chambre', orchestre: 'Orchestre' };
      Object.keys(groups).forEach((cat) => {
        const items = groups[cat];
        if (items.length === 0) return;
        const groupDiv = document.createElement('div');
        groupDiv.className = 'category-group';
        const heading = document.createElement('h3');
        heading.textContent = categoryNames[cat];
        groupDiv.appendChild(heading);
        const ul = document.createElement('ul');
        items.forEach(({ title, composer, index }) => {
          const li = document.createElement('li');
          li.style.display = 'flex';
          li.style.justifyContent = 'space-between';
          li.style.alignItems = 'center';
          const text = document.createElement('span');
          text.innerHTML = `<strong>${escapeHtml(title)}</strong> – ${escapeHtml(composer)}`;
          const delBtn = document.createElement('button');
          delBtn.textContent = 'Supprimer';
          delBtn.addEventListener('click', () => {
            if (confirm('Supprimer cette entrée du répertoire ?')) {
              repertoire.splice(index, 1);
              renderRepertoire();
              updateFirestoreData('repertoire', repertoire);
            }
          });
          li.appendChild(text);
          li.appendChild(delBtn);
          ul.appendChild(li);
        });
        groupDiv.appendChild(ul);
        repList.appendChild(groupDiv);
      });
    }
    document.getElementById('repertoire-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const titleInput = document.getElementById('rep-title');
      const composerInput = document.getElementById('rep-composer');
      const categorySelect = document.getElementById('rep-category');
      const title = titleInput.value.trim();
      const composer = composerInput.value.trim();
      const category = categorySelect.value;
      if (title && composer) {
        repertoire.push({ title, composer, category });
        renderRepertoire();
        updateFirestoreData('repertoire', repertoire);
        titleInput.value = '';
        composerInput.value = '';
        categorySelect.value = 'solo';
      }
    });
    // Initial render
    renderRepertoire();

    // ------ Agenda ------
    const agendaList = document.getElementById('agenda-list');
    let editingAgendaIndex = null;
    function renderAgenda() {
      // Sort ascending
      agenda.sort((a, b) => new Date(a.datetime) - new Date(b.datetime));
      agendaList.innerHTML = '';
      const now = new Date();
      agenda.forEach((item, index) => {
        const li = document.createElement('li');
        const eventDate = new Date(item.datetime);
        const diffMs = eventDate - now;
        const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
        let countdownText;
        if (diffDays > 1) countdownText = `Dans ${diffDays} jours`;
        else if (diffDays === 1) countdownText = 'Dans 1 jour';
        else if (diffDays === 0) countdownText = 'Aujourd’hui';
        else countdownText = 'Passé';
        if (diffDays >= 0 && diffDays <= 7) li.classList.add('soon');
        const options = { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' };
        const formatted = eventDate.toLocaleString('fr-CH', options).replace(',', '');
        const content = document.createElement('span');
        content.innerHTML = `<strong>${escapeHtml(item.title)}</strong> – ${formatted}`;
        if (item.note) {
          const noteDiv = document.createElement('span');
          noteDiv.className = 'note';
          noteDiv.textContent = item.note;
          content.appendChild(noteDiv);
        }
        if (typeof item.amount !== 'undefined' && item.amount !== null) {
          const detailsDiv = document.createElement('span');
          detailsDiv.className = 'details';
          const paidLabel = item.paid ? 'Réglé' : 'En attente';
          const amtStr = parseFloat(item.amount).toFixed(2);
          detailsDiv.textContent = `Montant : CHF ${amtStr} (${paidLabel})`;
          content.appendChild(detailsDiv);
        }
        if (item.contract) {
          const contractDiv = document.createElement('span');
          contractDiv.className = 'details';
          const link = document.createElement('a');
          link.href = item.contract;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.textContent = 'Contrat';
          contractDiv.appendChild(link);
          content.appendChild(contractDiv);
        }
        const countdownDiv = document.createElement('span');
        countdownDiv.className = 'countdown';
        countdownDiv.textContent = countdownText;
        content.appendChild(countdownDiv);
        const actions = document.createElement('div');
        actions.style.display = 'flex';
        actions.style.flexDirection = 'column';
        actions.style.gap = '0.25rem';
        const editBtn = document.createElement('button');
        editBtn.textContent = 'Modifier';
        editBtn.addEventListener('click', () => {
          editingAgendaIndex = index;
          document.getElementById('agenda-title').value = item.title;
          const d = new Date(item.datetime);
          document.getElementById('agenda-date').value = d.toISOString().slice(0, 10);
          document.getElementById('agenda-time').value = d.toTimeString().slice(0, 5);
          document.getElementById('agenda-note').value = item.note || '';
          document.getElementById('agenda-amount').value = typeof item.amount !== 'undefined' && item.amount !== null ? item.amount : '';
          document.getElementById('agenda-paid').checked = !!item.paid;
          document.getElementById('agenda-submit').textContent = 'Mettre à jour';
        });
        const delBtn = document.createElement('button');
        delBtn.textContent = 'Supprimer';
        delBtn.addEventListener('click', () => {
          if (confirm('Supprimer cet événement ?')) {
            agenda.splice(index, 1);
            renderAgenda();
            updateFirestoreData('agenda', agenda);
          }
        });
        actions.appendChild(editBtn);
        actions.appendChild(delBtn);
        li.appendChild(content);
        li.appendChild(actions);
        agendaList.appendChild(li);
      });
    }
    document.getElementById('agenda-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const titleInput = document.getElementById('agenda-title');
      const dateInput = document.getElementById('agenda-date');
      const timeInput = document.getElementById('agenda-time');
      const noteInput = document.getElementById('agenda-note');
      const amountInput = document.getElementById('agenda-amount');
      const paidInput = document.getElementById('agenda-paid');
      const contractInput = document.getElementById('agenda-contract');
      const title = titleInput.value.trim();
      const dateVal = dateInput.value;
      const timeVal = timeInput.value;
      const note = noteInput.value.trim();
      const amountVal = amountInput.value.trim();
      const amount = amountVal ? parseFloat(amountVal) : null;
      const paid = paidInput.checked;
      if (!title || !dateVal) return;
      const datetime = new Date(`${dateVal}T${timeVal ? timeVal : '00:00'}`).toISOString();
      const file = contractInput.files && contractInput.files[0];
      const readFileAsDataURL = (file) => {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (ev) => resolve(ev.target.result);
          reader.onerror = (err) => reject(err);
          reader.readAsDataURL(file);
        });
      };
      const saveEvent = async () => {
        let contractData = null;
        if (file) {
          try {
            contractData = await readFileAsDataURL(file);
          } catch (err) {
            console.error('Erreur de lecture du fichier :', err);
          }
        }
        if (editingAgendaIndex !== null) {
          const existing = agenda[editingAgendaIndex];
          agenda[editingAgendaIndex] = {
            ...existing,
            title,
            datetime,
            note,
            amount,
            paid,
            contract: contractData || existing.contract
          };
        } else {
          agenda.push({ title, datetime, note, amount, paid, contract: contractData });
        }
        renderAgenda();
        updateFirestoreData('agenda', agenda);
        // Reset form
        titleInput.value = '';
        dateInput.value = '';
        timeInput.value = '';
        noteInput.value = '';
        amountInput.value = '';
        paidInput.checked = false;
        contractInput.value = '';
        editingAgendaIndex = null;
        document.getElementById('agenda-submit').textContent = 'Ajouter';
      };
      saveEvent();
    });
    renderAgenda();

    // ------ Materials ------
    const materialsList = document.getElementById('materials-list');
    function renderMaterials() {
      materialsList.innerHTML = '';
      materials.forEach((item, index) => {
        if (typeof item.quantity === 'undefined') item.quantity = 1;
        if (typeof item.purchased === 'undefined') item.purchased = false;
        if (typeof item.lastChange === 'undefined') item.lastChange = null;
        if (!Array.isArray(item.history)) item.history = [];
        const li = document.createElement('li');
        if (item.purchased) li.classList.add('purchased');
        const container = document.createElement('div');
        container.style.flex = '1';
        container.style.display = 'flex';
        container.style.flexDirection = 'column';
        const topRow = document.createElement('div');
        topRow.style.display = 'flex';
        topRow.style.alignItems = 'center';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = item.purchased;
        checkbox.addEventListener('change', () => {
          item.purchased = checkbox.checked;
          renderMaterials();
          updateFirestoreData('materials', materials);
        });
        topRow.appendChild(checkbox);
        const label = document.createElement('span');
        label.textContent = `${item.name}`;
        topRow.appendChild(label);
        // Contrôles pour modifier rapidement la quantité de matériel
        const qtyControls = document.createElement('span');
        qtyControls.className = 'qty-controls';
        const minusBtn = document.createElement('button');
        minusBtn.type = 'button';
        minusBtn.textContent = '−';
        minusBtn.addEventListener('click', () => {
          if (item.quantity > 1) {
            item.quantity -= 1;
            renderMaterials();
            updateFirestoreData('materials', materials);
          }
        });
        const qtyDisplay = document.createElement('span');
        qtyDisplay.textContent = ` ${item.quantity} `;
        const plusBtn = document.createElement('button');
        plusBtn.type = 'button';
        plusBtn.textContent = '+';
        plusBtn.addEventListener('click', () => {
          item.quantity += 1;
          renderMaterials();
          updateFirestoreData('materials', materials);
        });
        qtyControls.appendChild(minusBtn);
        qtyControls.appendChild(qtyDisplay);
        qtyControls.appendChild(plusBtn);
        topRow.appendChild(qtyControls);
        container.appendChild(topRow);
        if (item.lastChange) {
          const dateSpan = document.createElement('span');
          dateSpan.className = 'details';
          const dateObj = new Date(item.lastChange);
          const options = { year: 'numeric', month: '2-digit', day: '2-digit' };
          dateSpan.textContent = 'Dernier changement : ' + dateObj.toLocaleDateString('fr-CH', options);
          container.appendChild(dateSpan);
        }
        const historyList = document.createElement('ul');
        historyList.className = 'history-list';
        historyList.style.display = 'none';
        item.history.forEach((d) => {
          const liHist = document.createElement('li');
          const dObj = new Date(d);
          liHist.textContent = dObj.toLocaleDateString('fr-CH', { year: 'numeric', month: '2-digit', day: '2-digit' });
          historyList.appendChild(liHist);
        });
        container.appendChild(historyList);
        const actions = document.createElement('div');
        actions.style.display = 'flex';
        actions.style.flexDirection = 'column';
        actions.style.gap = '0.25rem';
        const updateBtn = document.createElement('button');
        updateBtn.textContent = 'Maj date';
        updateBtn.addEventListener('click', () => {
          const dateInput = document.createElement('input');
          dateInput.type = 'date';
          dateInput.style.display = 'none';
          dateInput.addEventListener('change', () => {
            const newDate = dateInput.value;
            if (newDate) {
              if (item.lastChange) item.history.push(item.lastChange);
              item.lastChange = newDate;
              renderMaterials();
              updateFirestoreData('materials', materials);
            }
          });
          li.appendChild(dateInput);
          dateInput.click();
          dateInput.addEventListener('blur', () => {
            dateInput.remove();
          });
        });
        const histBtn = document.createElement('button');
        histBtn.textContent = 'Archives';
        histBtn.addEventListener('click', () => {
          historyList.style.display = historyList.style.display === 'none' ? 'block' : 'none';
        });
        const delBtn = document.createElement('button');
        delBtn.textContent = 'Supprimer';
        delBtn.addEventListener('click', () => {
          if (confirm('Supprimer cet article de matériel ?')) {
            materials.splice(index, 1);
            renderMaterials();
            updateFirestoreData('materials', materials);
          }
        });
        actions.appendChild(updateBtn);
        actions.appendChild(histBtn);
        actions.appendChild(delBtn);
        li.style.display = 'flex';
        li.style.justifyContent = 'space-between';
        li.appendChild(container);
        li.appendChild(actions);
        materialsList.appendChild(li);
      });
    }
    document.getElementById('materials-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const nameInput = document.getElementById('material-name');
      const qtyInput = document.getElementById('material-qty');
      const dateInput = document.getElementById('material-date');
      const name = nameInput.value.trim();
      const qtyVal = parseInt(qtyInput.value, 10);
      const qty = isNaN(qtyVal) || qtyVal < 1 ? 1 : qtyVal;
      const lastChange = dateInput.value ? dateInput.value : null;
      if (name) {
        materials.push({ name, quantity: qty, purchased: false, lastChange, history: [] });
        renderMaterials();
        updateFirestoreData('materials', materials);
        nameInput.value = '';
        qtyInput.value = '';
        dateInput.value = '';
      }
    });
    renderMaterials();

    // La logique du métronome et de l’accordeur a été retirée. Si des éléments
    // correspondants existent encore dans le DOM, ils resteront inactifs.

    // ------ Links (useful sites) ------
    const linksContainer = document.getElementById('links-container');
    function renderLinks() {
      linksContainer.innerHTML = '';
      links.forEach((item, index) => {
        const div = document.createElement('div');
        div.className = 'site-item';
        const a = document.createElement('a');
        a.href = item.url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = item.name;
        const delBtn = document.createElement('button');
        delBtn.textContent = 'Supprimer';
        delBtn.addEventListener('click', () => {
          if (confirm('Supprimer ce lien ?')) {
            links.splice(index, 1);
            renderLinks();
            updateFirestoreData('links', links);
          }
        });
        div.appendChild(a);
        div.appendChild(delBtn);
        linksContainer.appendChild(div);
      });
    }
    const linksForm = document.getElementById('links-form');
    if (linksForm) {
      linksForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const nameInput = document.getElementById('link-name');
        const urlInput = document.getElementById('link-url');
        let name = nameInput.value.trim();
        let url = urlInput.value.trim();
        if (name && url) {
          if (!/^https?:\/\//i.test(url)) {
            url = 'https://' + url;
          }
          links.push({ name, url });
          renderLinks();
          updateFirestoreData('links', links);
          nameInput.value = '';
          urlInput.value = '';
        }
      });
      renderLinks();
    }
  }
});