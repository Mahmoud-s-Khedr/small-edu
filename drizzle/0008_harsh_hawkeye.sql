ALTER TABLE `booking_requests` ADD `payer_name` text;--> statement-breakpoint
ALTER TABLE `booking_requests` ADD `payer_email` text;--> statement-breakpoint
UPDATE booking_requests SET payer_name = (SELECT name FROM users WHERE users.id = booking_requests.user_id), payer_email = (SELECT email FROM users WHERE users.id = booking_requests.user_id) WHERE user_id IS NOT NULL;--> statement-breakpoint
CREATE TRIGGER booking_requests_capture_payer AFTER INSERT ON booking_requests
WHEN NEW.user_id IS NOT NULL AND (NEW.payer_name IS NULL OR NEW.payer_email IS NULL)
BEGIN
  UPDATE booking_requests
  SET payer_name = COALESCE(NEW.payer_name, (SELECT name FROM users WHERE id = NEW.user_id)),
      payer_email = COALESCE(NEW.payer_email, (SELECT email FROM users WHERE id = NEW.user_id))
  WHERE id = NEW.id;
END;
