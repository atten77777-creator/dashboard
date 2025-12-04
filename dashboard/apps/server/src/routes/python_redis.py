import redis

# --- connect to your Redis Cloud database ---
r = redis.Redis(
    host='redis-16905.crce206.ap-south-1-1.ec2.redns.redis-cloud.com',
    port=16905,
    password='8IfUclkmIS47Ws5TczrKqQqasest2ADi',  # replace with your real one
    decode_responses=True
)

print("✅ Connected:", r.ping())   # simple connectivity test

# --- CREATE ---
r.hset("help:user:demo", mapping={"name": "Ali Demo", "email": "demo@example.com"})
r.zadd("help:queue:priority", {"ticket:demo": 10})
r.rpush("help:ticket:demo:log", "Ticket created by Ali Demo")
print("Created sample keys")

# --- READ ---
print("User hash →", r.hgetall("help:user:demo"))
print("Queue →", r.zrevrange("help:queue:priority", 0, -1, withscores=True))
print("Logs →", r.lrange("help:ticket:demo:log", 0, -1))

# --- UPDATE ---
r.hset("help:user:demo", "name", "Ali Updated")
r.rpush("help:ticket:demo:log", "Name updated to Ali Updated")
print("Updated user name →", r.hget("help:user:demo", "name"))

# --- DELETE ---
r.delete("help:user:demo", "help:queue:priority", "help:ticket:demo:log")
print("Deleted sample keys")

print("Done ✅")
