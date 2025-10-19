const ADMIN_USER = "admin";
const ADMIN_PASS = "12345";

function login() {
  const u = document.getElementById("username").value;
  const p = document.getElementById("password").value;
  const msg = document.getElementById("loginMsg");

  if (u === ADMIN_USER && p === ADMIN_PASS) {
    document.getElementById("loginBox").style.display = "none";
    document.getElementById("dashboard").style.display = "block";
    loadPending();
    loadKeys();
  } else {
    msg.innerHTML = "<div style='color:red'>Login gagal!</div>";
  }
}

async function loadPending() {
  const res = await fetch("/api/admin/pending");
  const j = await res.json();
  const div = document.getElementById("pendingList");
  if (!j.pending || j.pending.length === 0) {
    div.innerHTML = "<i>Tidak ada pending order</i>";
    return;
  }
  div.innerHTML = j.pending.map(o => {
    let proofHtml = '';
    if (o.proofPath) {
      // ensure path starts with / so it resolves from site root
      const path = o.proofPath.startsWith('/') ? o.proofPath : '/' + o.proofPath;
      proofHtml = `
        <div style="margin-top:8px">
          <a href="${path}" target="_blank" style="display:inline-block">
            <img src="${path}" onerror="this.style.display='none';this.nextElementSibling.style.display='block'" style="max-width:220px;max-height:160px;border-radius:6px;border:1px solid #222;display:block">
            <div style="display:none;color:#c9d6df;margin-top:6px">Gambar tidak dapat dimuat. Klik untuk lihat file.</div>
          </a>
        </div>`;
    }
    return `
    <div style="background:#0f1113;padding:10px;border-radius:8px;margin-bottom:8px">
      <b>${o.orderId}</b> - ${o.email}<br>
      Nama: ${o.name || '-'}<br>
      Produk: ${o.productId} x${o.qty}<br>
      Total: Rp${o.total}<br>
      ${proofHtml}
      <div style="margin-top:8px; display:flex; gap:8px;">
        <button onclick="verifyOrder('${o.orderId}')">Verifikasi & Kirim Key</button>
        <button onclick="cancelOrder('${o.orderId}')" style="background:#b33;color:#fff;border:none;padding:6px 10px;border-radius:6px">Cancel</button>
      </div>
    </div>
    `;
  }).join("");
}

async function loadKeys() {
  const res = await fetch("/api/keys");
  const data = await res.json();
  const div = document.getElementById("keyList");
  div.innerHTML = data.map(k => `
    <div>
      ${k.name} - ${k.value} 
      <span style="color:${k.sold ? 'red' : 'green'}">(${k.sold ? 'Terjual' : 'Tersedia'})</span>
    </div>
  `).join("");
}

async function verifyOrder(orderId) {
  if (!confirm("Yakin verifikasi order ini?")) return;
  const res = await fetch("/api/admin/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderId })
  });
  const j = await res.json();
  if (j.ok) {
    alert("Berhasil verifikasi. Key: " + j.assigned);
    loadPending();
    loadKeys();
  } else {
    alert("Gagal: " + j.message);
  }
}

async function cancelOrder(orderId) {
  if (!confirm("Yakin batalkan order ini?")) return;
  try {
    const res = await fetch("/api/admin/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId })
    });
    const j = await res.json();
    if (j.ok) {
      alert('Order dibatalkan.');
      loadPending();
      loadKeys();
    } else {
      alert('Gagal batalkan order: ' + (j.message || 'unknown'));
    }
  } catch (err) {
    console.error(err);
    alert('Gagal koneksi ke server.');
  }
}
