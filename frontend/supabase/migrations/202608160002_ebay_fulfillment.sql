-- Shipment tracking for paid eBay sales. Tracking is saved only after eBay accepts it.
alter table public.ebay_order_sales
  add column if not exists shipping_carrier_code text,
  add column if not exists tracking_number text,
  add column if not exists shipped_at timestamptz,
  add column if not exists shipment_error text;
