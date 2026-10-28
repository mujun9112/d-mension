// /api/toss/confirm — 토스페이먼츠 결제 승인 (MID dmensiadsq, /school 전용)
// 흐름: 결제창 성공 → /school/success?paymentKey&orderId&amount → 이 함수가 금액 검증 후 승인 호출
// 비밀키는 Vercel 환경변수 TOSS_SECRET_KEY(Sensitive)에서만 읽는다. 코드·저장소에 두지 않는다.

const PRODUCTS = {
  R1: { name: '포트폴리오 리뷰 · 기본', amount: 150000 },
  R2: { name: '포트폴리오 리뷰 · 재검토 포함', amount: 280000 },
  C1: { name: '8주 클래스 1기 · 창립가', amount: 390000, until: '2026-11-30T14:59:59Z' }, // 페이지 버튼은 11/23까지, 메일 신청자 결제는 11/30 23:59 KST까지
  C0: { name: '8주 클래스 1기 · 정가', amount: 490000 },
};

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.status(405).json({ ok: false, message: 'POST only' }); return; }

  const secret = process.env.TOSS_SECRET_KEY;
  if (!secret) { res.status(500).json({ ok: false, message: 'TOSS_SECRET_KEY not set' }); return; }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (_) { body = {}; } }
  const { paymentKey, orderId, amount } = body || {};
  if (!paymentKey || !orderId || !amount) { res.status(400).json({ ok: false, message: 'missing fields' }); return; }

  // orderId = <코드>-<yyyymmddHHMMSS>-<rand>  예: R1-20261020053000-a1b2c3
  const code = String(orderId).split('-')[0];
  const product = PRODUCTS[code];
  if (!product) { res.status(400).json({ ok: false, message: 'unknown product' }); return; }
  if (product.until && Date.now() > Date.parse(product.until)) {
    res.status(400).json({ ok: false, message: '창립가 기간이 끝났습니다. 정가로 다시 결제해 주세요.' }); return;
  }
  if (Number(amount) !== product.amount) {
    res.status(400).json({ ok: false, message: 'amount mismatch' }); return;
  }

  const auth = Buffer.from(secret + ':').toString('base64');
  let r, data;
  try {
    r = await fetch('https://api.tosspayments.com/v1/payments/confirm', {
      method: 'POST',
      headers: { Authorization: 'Basic ' + auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ paymentKey, orderId, amount: product.amount }),
    });
    data = await r.json();
  } catch (e) {
    res.status(502).json({ ok: false, message: 'toss unreachable' }); return;
  }
  if (!r.ok) { res.status(r.status).json({ ok: false, code: data.code, message: data.message }); return; }

  res.status(200).json({
    ok: true,
    orderId: data.orderId,
    orderName: data.orderName || product.name,
    amount: data.totalAmount,
    method: data.method,
    approvedAt: data.approvedAt,
    receiptUrl: data.receipt && data.receipt.url,
    test: /^test_/.test(secret),
  });
};
