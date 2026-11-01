// Serializes payment operations for a proposal in this single-process local app.
export function paymentService({get,save,provider}) {
  const locks = new Map();
  const refreshReads = new Map();
  async function locked(id, action) {
    const prior = locks.get(id) || Promise.resolve();
    const next = prior.catch(() => {}).then(async () => action(await get(id)));
    locks.set(id, next);
    try { return await next; }
    finally { if (locks.get(id) === next) locks.delete(id); }
  }
  async function reconcile(p, order) {
    if (order.id !== p.order) throw Error('PayPal returned an unexpected order.');
    p.providerStatus = order.status;
    p.lastChecked = new Date().toISOString();
    const captures = order.purchase_units?.flatMap(u => u.payments?.captures || []) || [];
    p.captureStatus = captures.find(c=>c.status==='COMPLETED')?.status || captures[0]?.status || null;
    if (order.status === 'COMPLETED') {
      const capture = captures.find(c => c.status === 'COMPLETED');
      if (!capture || capture.amount?.currency_code !== 'USD' ||
          capture.amount.value !== (p.cents / 100).toFixed(2)) {
        throw Error('Completed payment amount or currency does not match. Contact the freelancer before retrying.');
      }
      p.status = 'paid';
      p.capture = capture.id;
      p.paidAt ||= capture.create_time || new Date().toISOString();
    }
    await save(p);
    return p;
  }
  return {
    order: id => locked(id, async p => {
      if (p.status === 'paid') return {paid:true};
      if (p.demo) throw Error('Sample proposals cannot take payments.');
      if (!p.accepted) throw Error('Accept the scope change before payment.');
      if (!p.order) {
        const order = await provider('/v2/checkout/orders', {
          intent:'CAPTURE',
          purchase_units:[{custom_id:p.id,description:p.projectName+' — scope change',
            amount:{currency_code:'USD',value:(p.cents/100).toFixed(2)}}],
          payment_source:{paypal:{experience_context:{shipping_preference:'NO_SHIPPING'}}}
        }, p.id);
        if (!order.id) throw Error('PayPal did not return an order ID.');
        p.order=order.id; await save(p);
      } else {
        await reconcile(p, await provider('/v2/checkout/orders/'+p.order));
        if(p.status==='paid') return {paid:true};
        if(p.providerStatus==='VOIDED') throw Error('This PayPal order is no longer available. Ask for a new proposal.');
      }
      if (p.lastCheckout==='cancelled') {p.lastCheckout='resumed';await save(p);}
      return {id:p.order};
    }),
    capture: (id, orderID) => locked(id, async p => {
      if(p.demo) throw Error('Sample proposals cannot take payments.');
      if(!p.accepted || !p.order || orderID !== p.order) throw Error('Payment order does not match this accepted proposal.');
      if(p.status==='paid') return {paid:true};
      let order = await provider('/v2/checkout/orders/'+p.order);
      if(order.status !== 'COMPLETED') {
        if(order.status !== 'APPROVED') throw Error('PayPal has not approved this payment yet. Check payment status before retrying.');
        try {
          order = await provider('/v2/checkout/orders/'+p.order+'/capture', {}, p.id+'-capture');
        } catch(error) {
          // A response can be lost after PayPal captured. Read first, never create a replacement charge.
          order = await provider('/v2/checkout/orders/'+p.order);
          if(order.status !== 'COMPLETED') throw error;
        }
      }
      await reconcile(p,order);
      if(p.status!=='paid') throw Error('Payment is pending. Use Check payment status; do not start another payment.');
      return {paid:true};
    }),
    refresh: (id,{force=false}={}) => locked(id, async p => {
      if(p.order && !p.demo && p.status!=='paid' && (force || Date.now()-(refreshReads.get(id)||0)>=8000)) {
        refreshReads.set(id,Date.now());
        await reconcile(p, await provider('/v2/checkout/orders/'+p.order));
      }
      return {paid:p.status==='paid',status:p.status,providerStatus:p.providerStatus||null};
    }),
    cancel: id => locked(id, async p => {
      if(p.status!=='paid') {p.lastCheckout='cancelled';p.cancelledAt=new Date().toISOString();await save(p);}
      return {paid:p.status==='paid'};
    })
  };
}
