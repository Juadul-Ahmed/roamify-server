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

// POST /tours 
app.get("/tours", async (req, res) => {
  try {
    const { organizerId, search, category, sort, page = 1, limit = 9 } = req.query;

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

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, parseInt(limit, 10) || 6);
    const skip = (pageNum - 1) * limitNum;

    const [tours, totalCount] = await Promise.all([
      toursCollection.find(query).sort(sortSpec).skip(skip).limit(limitNum).toArray(),
      toursCollection.countDocuments(query),
    ]);

    res.status(200).json({
      tours,
      pagination: {
        page: pageNum,
        limit: limitNum,
        totalCount,
        totalPages: Math.ceil(totalCount / limitNum),
      },
    });
  } catch (err) {
    console.error("Error fetching tours:", err);
    res.status(500).json({ error: "Something went wrong on our end." });
  }
});

// GET /tours 
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

// GET /tours/:id
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

// PATCH /tours/:id 
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

// DELETE /tours/:id 
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

// POST /bookings 
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

app.patch("/bookings/:id/status", async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid booking id." });
    }

    const allowedStatuses = ["pending", "confirmed", "cancelled"];
    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({ error: "Invalid status." });
    }

    const result = await bookingsCollection.findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $set: { status, updatedAt: new Date() } },
      { returnDocument: "after" }
    );

    if (!result) {
      return res.status(404).json({ error: "Booking not found." });
    }

    res.status(200).json({ message: "Booking status updated.", booking: result });
  } catch (err) {
    console.error("Error updating booking status:", err);
    res.status(500).json({ error: "Something went wrong on our end." });
  }
});

// GET /organizer/stats
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
// GET /admin/stats
app.get("/admin/stats", async (req, res) => {
  try {
    const [totalUsers, totalOrganizers, totalTravelers, totalTours, allBookings] = await Promise.all([
      usersCollection.countDocuments({}),
      usersCollection.countDocuments({ role: "organizer" }),
      usersCollection.countDocuments({ role: "traveler" }),
      toursCollection.countDocuments({}),
      bookingsCollection.find({}).toArray(),
    ]);

    const totalBookings = allBookings.length;

    const totalRevenue = allBookings
      .filter((b) => b.status !== "cancelled")
      .reduce((sum, b) => sum + (b.totalPrice || 0), 0);

    res.status(200).json({
      stats: {
        totalUsers,
        totalOrganizers,
        totalTravelers,
        totalTours,
        totalBookings,
        totalRevenue,
      },
    });
  } catch (err) {
    console.error("Error fetching admin stats:", err);
    res.status(500).json({ error: "Something went wrong on our end." });
  }
});

// GET /admin/users — list all users, with optional search and role filter
app.get("/admin/users", async (req, res) => {
  try {
    const { search, role } = req.query;

    const query = {};

    if (role && role !== "All") {
      query.role = role;
    }

    if (search) {
      const regex = { $regex: String(search), $options: "i" };
      query.$or = [{ name: regex }, { email: regex }];
    }

    const users = await usersCollection
      .find(query)
      .sort({ createdAt: -1 })
      .project({ name: 1, email: 1, role: 1, createdAt: 1, emailVerified: 1 })
      .toArray();

    res.status(200).json({ users });
  } catch (err) {
    console.error("Error fetching users:", err);
    res.status(500).json({ error: "Something went wrong on our end." });
  }
});

// PATCH /admin/users/:id/role — change a user's role (admin only action)
app.patch("/admin/users/:id/role", async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid user id." });
    }

    const allowedRoles = ["traveler", "organizer", "admin"];
    if (!allowedRoles.includes(role)) {
      return res.status(400).json({ error: "Invalid role." });
    }

    const result = await usersCollection.findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $set: { role, updatedAt: new Date() } },
      { returnDocument: "after" }
    );

    if (!result) {
      return res.status(404).json({ error: "User not found." });
    }

    res.status(200).json({ message: "Role updated successfully.", user: result });
  } catch (err) {
    console.error("Error updating user role:", err);
    res.status(500).json({ error: "Something went wrong on our end." });
  }
});

// DELETE /admin/users/:id — remove a user account
app.delete("/admin/users/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid user id." });
    }

    const result = await usersCollection.deleteOne({ _id: new ObjectId(id) });

    if (result.deletedCount === 0) {
      return res.status(404).json({ error: "User not found." });
    }

    res.status(200).json({ message: "User deleted successfully." });
  } catch (err) {
    console.error("Error deleting user:", err);
    res.status(500).json({ error: "Something went wrong on our end." });
  }
});

// GET /admin/analytics
app.get("/admin/analytics", async (req, res) => {
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);


    const signupsByDay = await usersCollection
      .aggregate([
        { $match: { createdAt: { $gte: thirtyDaysAgo } } },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ])
      .toArray();


    const revenueByDay = await bookingsCollection
      .aggregate([
        {
          $match: {
            createdAt: { $gte: thirtyDaysAgo },
            status: { $ne: "cancelled" },
          },
        },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
            revenue: { $sum: "$totalPrice" },
          },
        },
        { $sort: { _id: 1 } },
      ])
      .toArray();


    const roleDistribution = await usersCollection
      .aggregate([
        { $group: { _id: "$role", count: { $sum: 1 } } },
      ])
      .toArray();

  
    const bookingStatusBreakdown = await bookingsCollection
      .aggregate([
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ])
      .toArray();

    res.status(200).json({
      signupsByDay,
      revenueByDay,
      roleDistribution,
      bookingStatusBreakdown,
    });
  } catch (err) {
    console.error("Error fetching admin analytics:", err);
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