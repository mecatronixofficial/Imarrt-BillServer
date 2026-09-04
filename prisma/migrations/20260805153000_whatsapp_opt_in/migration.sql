-- Explicit customer consent gate for automatic WhatsApp delivery.
ALTER TABLE `customers`
  ADD COLUMN `whatsappOptIn` BOOLEAN NOT NULL DEFAULT false;
