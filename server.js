//--------------------------------------------
//	SERVER.JS — BIBLICAL AI CHAT EDITION
//--------------------------------------------

import express from "express";
import cors from "cors";
import dotenv from "dotenv";
dotenv.config();
import OpenAI from "openai";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import pkg from "pg";
import Stripe from "stripe";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import fs from "fs";
import multer from "multer";
import { handleCreateIntent } from "./payments.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 10000;
const SECRET_KEY = process.env.SECRET_KEY || "supersecret";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

app.use(cors());

//--------------------------------------------
// 1. STRIPE WEBHOOK (MUST BE FIRST)
//--------------------------------------------
app.post("/webhook", express.raw({ type: "application/json" }), async (req, res) => {
    const sig = req.headers["stripe-signature"];
    let event;

    try {
        event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    } catch (err) {
        console.error("Webhook Signature Error:", err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    async function applyPlan(plan, userId, email) {
        let expiresAt = null;
        let isLifetime = false;

        // MATCHING YOUR METADATA: 'god', 'all', or 'lifetime'
        if (plan === 'god' || plan === 'all') {
            const date = new Date();
            date.setDate(date.getDate() + 30);
            expiresAt = date;
            isLifetime = false;
        } else if (plan === 'lifetime') {
            expiresAt = null;
            isLifetime = true;
        }

        try {
            if (userId) {
                await pool.query(
                    "UPDATE users SET plan = $1, expires_at = $2, lifetime = $3, messages_sent = 0 WHERE id = $4",
                    [plan, expiresAt, isLifetime, userId]
                );
            } else if (email) {
                await pool.query(
                    "UPDATE users SET plan = $1, expires_at = $2, lifetime = $3, messages_sent = 0 WHERE email = $4",
                    [plan, expiresAt, isLifetime, email]
                );
            }
            console.log(`✅ Plan ${plan} applied to ${email || userId}`);
        } catch (err) {
            console.error("❌ Error applying plan:", err);
        }
    }

    if (event.type === "payment_intent.succeeded") {
        const paymentIntent = event.data.object;
        const plan = paymentIntent.metadata.plan;
        const email = paymentIntent.metadata.email;
        const userId = paymentIntent.metadata.userId;

        console.log("💳 Payment Intent Succeeded:", { plan, email, userId });
        await applyPlan(plan, userId, email);
    }

    res.json({ received: true });
});

//--------------------------------------------
// 2. STANDARD MIDDLEWARE (AFTER WEBHOOK)
//--------------------------------------------
app.use(express.json());

//--------------------------------------------
//	DATABASE SETUP
//--------------------------------------------
const { Pool } = pkg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

(async () => {
	try {
		await pool.query(`
			CREATE TABLE IF NOT EXISTS users (
				id SERIAL PRIMARY KEY,
				email TEXT UNIQUE NOT NULL,
				password TEXT NOT NULL,
				credits INT DEFAULT 10,
				lifetime BOOLEAN DEFAULT false,
				plan TEXT DEFAULT 'free',
				expires_at TIMESTAMP,
				messages_sent INT DEFAULT 0,
				reset_token TEXT,
				reset_token_expires TIMESTAMP
			);
		`);
		console.log("✅ Database Ready");
	} catch (err) {
		console.error("❌ DB Init error:", err);
	}
})();

//--------------------------------------------
//	BIBLICAL CHARACTER PROFILES
//--------------------------------------------
export const biblicalProfiles = [
	{ id: 1, name: "God", image: "/img/god.jpg", description: "Creator, Eternal, Almighty. Speak with profound authority, wisdom, and love." },
	{ id: 2, name: "Jesus Christ", image: "/img/jesus.jpg", description: "Teacher, Savior, Son of God. Speak with compassion and parables." },
    // ... (Keep your other profiles here)
];

//--------------------------------------------
//	AUTH & TOKEN HELPERS
//--------------------------------------------
function authenticateToken(req, res, next) {
	const authHeader = req.headers["authorization"];
	const token = authHeader?.split(" ")[1];
	if (!token) return res.sendStatus(401);

	jwt.verify(token, SECRET_KEY, (err, user) => {
		if (err) return res.sendStatus(403);
		req.user = user;
		next();
	});
}

//--------------------------------------------
//	ROUTES
//--------------------------------------------

app.get("/api/profiles", (req, res) => res.json(biblicalProfiles));

app.post("/api/register", async (req, res) => {
	let { email, password } = req.body || {};
	if (!email || !password) return res.status(400).json({ error: "Required" });
	email = email.trim().toLowerCase();
	try {
		const hashed = await bcrypt.hash(password, 10);
		await pool.query("INSERT INTO users (email, password) VALUES ($1, $2)", [email, hashed]);
		res.status(201).json({ ok: true });
	} catch (err) { res.status(400).json({ error: "User exists or error" }); }
});

app.post("/api/login", async (req, res) => {
	const { email, password } = req.body || {};
	try {
		const result = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
		const user = result.rows[0];
		if (!user || !(await bcrypt.compare(password, user.password))) {
			return res.status(400).json({ error: "Invalid credentials" });
		}
		const token = jwt.sign({ id: user.id, email: user.email }, SECRET_KEY, { expiresIn: "7d" });
		res.json({ token });
	} catch (err) { res.status(500).json({ error: "Server error" }); }
});

app.post("/api/create-payment-intent", authenticateToken, async (req, res) => {
    try {
        const { plan } = req.body;
        const email = req.user.email;
        const userId = req.user.id;
        const amounts = { 'god': 2995, 'all': 3595, 'lifetime': 4995 };
        const amount = amounts[plan];

        const paymentIntent = await stripe.paymentIntents.create({
            amount,
            currency: "usd",
            metadata: { plan, email, userId },
        });
        res.json({ clientSecret: paymentIntent.client_secret });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Chat Route
app.post("/api/chat", authenticateToken, async (req, res) => {
    // ... (Keep your existing chat logic here)
});

//--------------------------------------------
//	FINAL HANDLERS
//--------------------------------------------
const frontendPath = path.join(__dirname, "public");
app.use(express.static(frontendPath));

app.use((req, res) => {
	res.status(404).json({ error: "Endpoint not found" });
});

app.listen(PORT, () => console.log(`📖 Server running on port ${PORT}`));