-- =============================================================================
-- Demo data: two fictional brands whose policies deliberately differ, so it is
-- easy to verify that one brand's knowledge never leaks into the other's
-- replies.
--
--                      Kesari Oils                Dewdrop Skincare
--   Refund window      7 days                     30 days
--   Damage reporting   48 hours, replacement      7 days, refund OR replacement
--   Returns            unopened only, 7 days      opened OK, 15 days
--   Free shipping      above ₹999                 above ₹499
--   Cancellation       before dispatch only       within 24 hours of ordering
--
-- Timestamps are relative to now(), so "delivered 20 days ago" stays true
-- whenever the demo is opened. Fixed UUIDs make the seed idempotent.
-- Agent accounts are created separately by `npm run seed:users`.
-- =============================================================================

insert into public.brands (id, slug, name, tone, support_email) values
  ('11111111-1111-1111-1111-111111111111', 'kesari-oils', 'Kesari Oils',
   'Warm and respectful. Address the customer by first name. Keep replies short (WhatsApp style, 2-5 sentences). Sign off as "Team Kesari".',
   'care@kesarioils.example'),
  ('22222222-2222-2222-2222-222222222222', 'dewdrop-skincare', 'Dewdrop Skincare',
   'Upbeat and caring, light on jargon. Address the customer by first name. Keep replies short (WhatsApp style, 2-5 sentences). Sign off as "Dewdrop Care Team".',
   'hello@dewdropskin.example')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Knowledge base — Kesari Oils (cold-pressed cooking oils in glass bottles)
-- ---------------------------------------------------------------------------
insert into public.kb_entries (id, brand_id, category, title, content, keywords) values
  ('f0000000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111', 'refunds',
   'Refund policy',
   'Refunds are only permitted within 7 days of delivery. After 7 days from delivery, orders are not eligible for a refund. Approved refunds are issued to the original payment method within 5-7 working days after the returned item passes inspection. Cash-on-delivery orders are refunded by bank transfer (NEFT) once the customer shares their bank details. Shipping charges are non-refundable.',
   'money back, reimburse, refund status'),
  ('f0000000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111', 'returns',
   'Return policy',
   'Unopened products can be returned within 7 days of delivery. Opened bottles cannot be returned for food-safety reasons, unless the product arrived damaged or defective. To start a return the customer must share their order number; our courier partner picks up the item within 3 working days.',
   'send back, exchange, return pickup'),
  ('f0000000-0000-0000-0000-0000000000a3', '11111111-1111-1111-1111-111111111111', 'damaged_items',
   'Damaged or leaking bottles',
   'If a bottle arrives broken, cracked or leaking, the customer must report it within 48 hours of delivery and share a photo of the damaged product and the outer packaging. Once verified, we send a free replacement within 3-5 working days; the customer does not need to return the broken bottle. If the product is out of stock, we offer a full refund instead. Damage reported more than 48 hours after delivery is reviewed case by case by a supervisor.',
   'broken, cracked, leaked, leaking, shattered, damaged, defective, spilled, glass'),
  ('f0000000-0000-0000-0000-0000000000a4', '11111111-1111-1111-1111-111111111111', 'shipping',
   'Shipping & delivery',
   'Shipping is free on orders above ₹999; below that a ₹79 shipping fee applies. Orders are dispatched within 1 working day. Delivery takes 3-5 working days to metro cities and 5-8 working days elsewhere in India. A tracking link is sent on WhatsApp and email once the order is dispatched.',
   'delivery time, courier, tracking, when will it arrive, dispatch'),
  ('f0000000-0000-0000-0000-0000000000a5', '11111111-1111-1111-1111-111111111111', 'cancellation',
   'Cancellation policy',
   'Orders can be cancelled free of charge only before they are dispatched. Once an order has been dispatched it cannot be cancelled. The customer can instead refuse the delivery, or return the unopened product within 7 days of delivery under the return policy.',
   'cancel, cancel order, stop order'),
  ('f0000000-0000-0000-0000-0000000000a6', '11111111-1111-1111-1111-111111111111', 'general',
   'Support hours & contact',
   'Customer care is available Monday to Saturday, 10 am to 7 pm IST, on WhatsApp and at care@kesarioils.example. Messages received outside these hours are answered the next working day.',
   'contact, phone, email, timings, working hours')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Knowledge base — Dewdrop Skincare (serums in glass dropper bottles)
-- ---------------------------------------------------------------------------
insert into public.kb_entries (id, brand_id, category, title, content, keywords) values
  ('f0000000-0000-0000-0000-0000000000b1', '22222222-2222-2222-2222-222222222222', 'refunds',
   'Refund policy',
   'Refunds are permitted within 30 days of delivery, for any reason. Refunds are credited to the original payment method within 3 working days of the return pickup. Customers may choose store credit instead, which is issued instantly with a 10% bonus.',
   'money back, reimburse, refund status, store credit'),
  ('f0000000-0000-0000-0000-0000000000b2', '22222222-2222-2222-2222-222222222222', 'returns',
   'Return policy',
   'Products can be returned within 15 days of delivery, even if opened, as long as at least half of the product remains. Return pickup is free and is scheduled within 2 working days of the request.',
   'send back, exchange, return pickup, did not suit, allergy'),
  ('f0000000-0000-0000-0000-0000000000b3', '22222222-2222-2222-2222-222222222222', 'damaged_items',
   'Damaged products',
   'If a product arrives damaged (broken glass, cracked dropper, leaking bottle or missing seal), the customer should report it within 7 days of delivery with a photo. The customer can choose either a free replacement, shipped within 2 working days, or a full refund including shipping charges. The damaged item does not need to be returned.',
   'broken, cracked, leaked, leaking, shattered, damaged, defective, spilled, dropper, seal'),
  ('f0000000-0000-0000-0000-0000000000b4', '22222222-2222-2222-2222-222222222222', 'shipping',
   'Shipping & delivery',
   'Shipping is free on orders above ₹499; below that a ₹49 shipping fee applies. Standard delivery takes 5-7 working days across India. Express delivery in 2-3 working days is available in select cities for ₹99.',
   'delivery time, courier, tracking, when will it arrive, dispatch, express'),
  ('f0000000-0000-0000-0000-0000000000b5', '22222222-2222-2222-2222-222222222222', 'cancellation',
   'Cancellation policy',
   'Orders can be cancelled within 24 hours of being placed for a full refund, even if they have already been dispatched. After 24 hours orders cannot be cancelled, but they can be returned after delivery under the return policy.',
   'cancel, cancel order, stop order'),
  ('f0000000-0000-0000-0000-0000000000b6', '22222222-2222-2222-2222-222222222222', 'general',
   'Support hours & contact',
   'The Dewdrop Care Team is available every day from 9 am to 9 pm IST on WhatsApp and at hello@dewdropskin.example.',
   'contact, phone, email, timings, working hours')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Customers
-- ---------------------------------------------------------------------------
insert into public.customers (id, brand_id, name, phone, email) values
  ('c0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Priya Sharma', '+91 98200 11234', 'priya.sharma@mail.example'),
  ('c0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Rahul Verma',  '+91 98110 45678', 'rahul.verma@mail.example'),
  ('c0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Ananya Rao',   '+91 99000 22110', 'ananya.rao@mail.example'),
  ('c0000000-0000-0000-0000-000000000004', '22222222-2222-2222-2222-222222222222', 'Meera Iyer',   '+91 98450 77889', 'meera.iyer@mail.example'),
  ('c0000000-0000-0000-0000-000000000005', '22222222-2222-2222-2222-222222222222', 'Arjun Nair',   '+91 97400 33445', 'arjun.nair@mail.example'),
  ('c0000000-0000-0000-0000-000000000006', '22222222-2222-2222-2222-222222222222', 'Kabir Malhotra','+91 98990 55667', 'kabir.m@mail.example')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Orders
-- ---------------------------------------------------------------------------
insert into public.orders (id, brand_id, customer_id, order_number, items, total_amount, status, placed_at, delivered_at) values
  ('d0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-000000000001',
   'KO-10482', '[{"name":"Cold-Pressed Groundnut Oil, 1 L glass bottle","qty":2,"price":649}]', 1298, 'delivered',
   now() - interval '4 days', now() - interval '3 hours'),
  ('d0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-000000000002',
   'KO-10391', '[{"name":"Virgin Coconut Oil, 500 ml glass bottle","qty":1,"price":449}]', 528, 'delivered',
   now() - interval '24 days', now() - interval '20 days'),
  ('d0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-000000000003',
   'KO-10577', '[{"name":"Cold-Pressed Mustard Oil, 1 L glass bottle","qty":1,"price":549},{"name":"Sesame Oil, 500 ml","qty":1,"price":399}]', 948, 'dispatched',
   now() - interval '1 day', null),
  ('d0000000-0000-0000-0000-000000000004', '22222222-2222-2222-2222-222222222222', 'c0000000-0000-0000-0000-000000000004',
   'DD-2214', '[{"name":"10% Vitamin C Serum, 30 ml","qty":1,"price":799}]', 799, 'delivered',
   now() - interval '25 days', now() - interval '20 days'),
  ('d0000000-0000-0000-0000-000000000005', '22222222-2222-2222-2222-222222222222', 'c0000000-0000-0000-0000-000000000005',
   'DD-2251', '[{"name":"Niacinamide 5% Serum, 30 ml","qty":1,"price":649},{"name":"Hydrating Gel Moisturiser, 50 g","qty":1,"price":449}]', 1098, 'delivered',
   now() - interval '6 days', now() - interval '2 days'),
  ('d0000000-0000-0000-0000-000000000006', '22222222-2222-2222-2222-222222222222', 'c0000000-0000-0000-0000-000000000006',
   'DD-2263', '[{"name":"Ceramide Barrier Cream, 50 g","qty":1,"price":699}]', 748, 'delivered',
   now() - interval '9 days', now() - interval '5 days')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Conversations
-- ---------------------------------------------------------------------------
insert into public.conversations (id, brand_id, customer_id, order_id, channel) values
  ('e0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'whatsapp'),
  ('e0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000002', 'whatsapp'),
  ('e0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000003', 'email'),
  ('e0000000-0000-0000-0000-000000000004', '22222222-2222-2222-2222-222222222222', 'c0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-000000000004', 'whatsapp'),
  ('e0000000-0000-0000-0000-000000000005', '22222222-2222-2222-2222-222222222222', 'c0000000-0000-0000-0000-000000000005', 'd0000000-0000-0000-0000-000000000005', 'whatsapp'),
  ('e0000000-0000-0000-0000-000000000006', '22222222-2222-2222-2222-222222222222', 'c0000000-0000-0000-0000-000000000006', 'd0000000-0000-0000-0000-000000000006', 'web')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Messages (the trigger keeps conversations.last_message_at/status in sync)
-- ---------------------------------------------------------------------------
insert into public.messages (id, brand_id, conversation_id, sender_type, body, created_at) values
  -- Priya / Kesari: the scenario from the brief (damage, within 48 h)
  ('90000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'e0000000-0000-0000-0000-000000000001', 'customer',
   'Hi, when will my order KO-10482 arrive?', now() - interval '2 days'),
  ('90000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'e0000000-0000-0000-0000-000000000001', 'agent',
   'Hi Priya! Your order has been dispatched and should reach you within the next 2 days. Team Kesari', now() - interval '2 days' + interval '20 minutes'),
  ('90000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'e0000000-0000-0000-0000-000000000001', 'customer',
   'My order was delivered but the bottle is broken. What can I do?', now() - interval '1 hour'),

  -- Rahul / Kesari: refund requested 20 days after delivery (7-day window)
  ('90000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'e0000000-0000-0000-0000-000000000002', 'customer',
   'I received this 20 days ago. Can I get a refund?', now() - interval '3 hours'),

  -- Ananya / Kesari: cancellation after dispatch
  ('90000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'e0000000-0000-0000-0000-000000000003', 'customer',
   'Hello, I ordered by mistake yesterday. Can I cancel my order please?', now() - interval '5 hours'),

  -- Meera / Dewdrop: the SAME refund question, but this brand allows 30 days
  ('90000000-0000-0000-0000-000000000006', '22222222-2222-2222-2222-222222222222', 'e0000000-0000-0000-0000-000000000004', 'customer',
   'I received this 20 days ago. Can I get a refund?', now() - interval '2 hours'),

  -- Arjun / Dewdrop: damage, different remedy than Kesari
  ('90000000-0000-0000-0000-000000000007', '22222222-2222-2222-2222-222222222222', 'e0000000-0000-0000-0000-000000000005', 'customer',
   'The serum bottle arrived cracked and it leaked all over the box', now() - interval '40 minutes'),

  -- Kabir / Dewdrop: nothing in the knowledge base covers this
  ('90000000-0000-0000-0000-000000000008', '22222222-2222-2222-2222-222222222222', 'e0000000-0000-0000-0000-000000000006', 'customer',
   'Do you have a physical store in Bangalore where I can try the products before buying?', now() - interval '30 minutes')
on conflict (id) do nothing;
