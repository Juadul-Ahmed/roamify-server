import dns from "node:dns";
dns.setServers(["8.8.8.8", "8.8.4.4"]);

import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { MongoClient, ObjectId } from "mongodb";

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;

app.use(
  cors({
    origin: "http://localhost:3000",
    credentials: true,
  })
);
app.use(express.json());

if (!process.env.MONGO_DB_URI) {
  throw new Error("MONGO_DB_URI environment variable is missing inside your .env configuration.");
}

const client = new MongoClient(process.env.MONGO_DB_URI);
const dbName = process.env.DB_NAME || "roamify";
const db = client.db(dbName);

const toursCollection = db.collection("tours");
const usersCollection = db.collection("user");
const bookingsCollection = db.collection("bookings");

app.get("/", (req, res) => {
  res.send("Hello World!");
});

// POST /tours — create a new tour
app.post("/tours", async (req, res) => {
  try {
    const { title, location, price, category, description, image, organizerId, organizerName } = req.body;

    if (!title || !location || !price || !category || !description || !image) {
      return res.status(400).json({ error: "All fields are required." });
    }

    const tour = {
      title,
      location,
      price: Number(price),
      category,
      description,
      image,
      rating: 0,
      organizerId,
      organizerName,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await toursCollection.insertOne(tour);

    res.status(201).json({ message: "Tour created successfully.", tourId: result.insertedId });
  } catch (err) {
    console.error("Error creating tour:", err);
    res.status(500).json({ error: "Something went wrong on our end." });
  }
});

// GET /tours — list tours. organizerId filters to one organizer's tours
// (used by the dashboard); omit it for public browsing (used by Explore).
app.get("/tours", async (req, res) => {
  try {
    const { organizerId, search, category, sort } = req.query;

    const query = {};

    if (organizerId) {
      query.organizerId = organizerId;
    }

    if (category && category !== "All") {
      query.category = category;
    }

    if (search) {
      const regex = { $regex: String(search), $options: "i" };
      query.$or = [{ title: regex }, { location: regex }];
    }

    let sortSpec = { createdAt: -1 };
    if (sort === "price_asc") sortSpec = { price: 1 };
    else if (sort === "price_desc") sortSpec = { price: -1 };

    const tours = await toursCollection.find(query).sort(sortSpec).toArray();

    res.status(200).json({ tours });
  } catch (err) {
    console.error("Error fetching tours:", err);
    res.status(500).json({ error: "Something went wrong on our end." });
  }
});

// GET /tours/:id — fetch a single tour (for prefilling the edit form)
app.get("/tours/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid tour id." });
    }

    const tour = await toursCollection.findOne({ _id: new ObjectId(id) });

    if (!tour) {
      return res.status(404).json({ error: "Tour not found." });
    }

    res.status(200).json({ tour });
  } catch (err) {
    console.error("Error fetching tour:", err);
    res.status(500).json({ error: "Something went wrong on our end." });
  }
});

// PATCH /tours/:id — update an existing tour
app.patch("/tours/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid tour id." });
    }

    const { title, location, price, category, description, image } = req.body;

    if (!title || !location || !price || !category || !description || !image) {
      return res.status(400).json({ error: "All fields are required." });
    }

    // organizerId/organizerName are intentionally NOT taken from req.body here —
    // ownership shouldn't change on an edit. Once auth middleware is added, this
    // route should also verify req.user.id matches the tour's existing organizerId
    // before allowing the update.

    const result = await toursCollection.findOneAndUpdate(
      { _id: new ObjectId(id) },
      {
        $set: {
          title,
          location,
          price: Number(price),
          category,
          description,
          image,
          updatedAt: new Date(),
        },
      },
      { returnDocument: "after" }
    );

    if (!result) {
      return res.status(404).json({ error: "Tour not found." });
    }

    res.status(200).json({ message: "Tour updated successfully.", tour: result });
  } catch (err) {
    console.error("Error updating tour:", err);
    res.status(500).json({ error: "Something went wrong on our end." });
  }
});

// DELETE /tours/:id — remove a tour
app.delete("/tours/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid tour id." });
    }

    const result = await toursCollection.deleteOne({ _id: new ObjectId(id) });

    if (result.deletedCount === 0) {
      return res.status(404).json({ error: "Tour not found." });
    }

    res.status(200).json({ message: "Tour deleted successfully." });
  } catch (err) {
    console.error("Error deleting tour:", err);
    res.status(500).json({ error: "Something went wrong on our end." });
  }
});

// POST /bookings — create a new booking for a tour
app.post("/bookings", async (req, res) => {
  try {
    const { tourId, userId, userName, userEmail, guests, date } = req.body;

    if (!tourId || !userId || !guests || !date) {
      return res.status(400).json({ error: "tourId, userId, guests, and date are required." });
    }

    if (!ObjectId.isValid(tourId)) {
      return res.status(400).json({ error: "Invalid tour id." });
    }

    const tour = await toursCollection.findOne({ _id: new ObjectId(tourId) });

    if (!tour) {
      return res.status(404).json({ error: "Tour not found." });
    }

    const guestCount = Number(guests);

    if (!Number.isInteger(guestCount) || guestCount < 1) {
      return res.status(400).json({ error: "Guests must be a positive whole number." });
    }

    const booking = {
      tourId,
      tourTitle: tour.title,
      tourImage: tour.image,
      organizerId: tour.organizerId,
      userId,
      userName: userName || null,
      userEmail: userEmail || null,
      guests: guestCount,
      date: new Date(date),
      pricePerPerson: tour.price,
      totalPrice: tour.price * guestCount,
      status: "pending",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await bookingsCollection.insertOne(booking);

    res.status(201).json({ message: "Booking created successfully.", bookingId: result.insertedId });
  } catch (err) {
    console.error("Error creating booking:", err);
    res.status(500).json({ error: "Something went wrong on our end." });
  }
});

// GET /organizer/stats — aggregated dashboard numbers for one organizer
app.get("/organizer/stats", async (req, res) => {
  try {
    const { organizerId } = req.query;

    if (!organizerId) {
      return res.status(400).json({ error: "organizerId is required." });
    }

    const tours = await toursCollection.find({ organizerId }).toArray();
    const bookings = await bookingsCollection.find({ organizerId }).toArray();

    const totalTours = tours.length;
    const totalBookings = bookings.length;

    const totalRevenue = bookings
      .filter((b) => b.status !== "cancelled")
      .reduce((sum, b) => sum + (b.totalPrice || 0), 0);

    const ratedTours = tours.filter((t) => typeof t.rating === "number" && t.rating > 0);
    const averageRating =
      ratedTours.length > 0
        ? ratedTours.reduce((sum, t) => sum + t.rating, 0) / ratedTours.length
        : 0;

    res.status(200).json({
      stats: {
        totalTours,
        totalBookings,
        totalRevenue,
        averageRating,
      },
    });
  } catch (err) {
    console.error("Error fetching organizer stats:", err);
    res.status(500).json({ error: "Something went wrong on our end." });
  }
});
app.get("/bookings", async (req, res) => {
  try {
    const { userId, organizerId } = req.query;

    if (!userId && !organizerId) {
      return res.status(400).json({ error: "userId or organizerId is required." });
    }

    const query = userId ? { userId } : { organizerId };

    const bookings = await bookingsCollection.find(query).sort({ createdAt: -1 }).toArray();

    res.status(200).json({ bookings });
  } catch (err) {
    console.error("Error fetching bookings:", err);
    res.status(500).json({ error: "Something went wrong on our end." });
  }
});

// DELETE /bookings/:id — cancel a booking
app.delete("/bookings/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid booking id." });
    }

    const result = await bookingsCollection.deleteOne({ _id: new ObjectId(id) });

    if (result.deletedCount === 0) {
      return res.status(404).json({ error: "Booking not found." });
    }

    res.status(200).json({ message: "Booking cancelled successfully." });
  } catch (err) {
    console.error("Error cancelling booking:", err);
    res.status(500).json({ error: "Something went wrong on our end." });
  }
});

async function startServer() {
  try {
    await client.connect();
    console.log("You successfully connected to MongoDB!");

    app.listen(port, () => {
      console.log(`Example app listening on port ${port}`);
    });
  } catch (err) {
    console.error("Failed to connect to MongoDB:", err);
    process.exit(1);
  }
}

startServer();