-- Get trigger definition on auth.users if possible
SELECT action_statement 
FROM information_schema.triggers 
WHERE event_object_schema = 'auth' AND event_object_table = 'users';
