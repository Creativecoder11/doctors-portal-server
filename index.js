const express = require("express");
const cors = require("cors");
const app = express();
require("dotenv").config();
const jwt = require('jsonwebtoken');
const port = process.env.PORT || 5000;
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY)

app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.xk97zuc.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverApi: ServerApiVersion.v1,
});

function verifyJWT(req, res, next) {

  const authHeader = req.headers.authorization;
  if (!authHeader) {
      return res.status(401).send('unauthorized access');
  }

  const token = authHeader.split(' ')[1];

  jwt.verify(token, process.env.ACCESS_TOKEN, function (err, decoded) {
    if (err) {
        return res.status(403).send({ message: 'forbidden access' })
    }
    req.decoded = decoded;
    next();
})

}

async function run() {
  try {
    const appointmentOptions = client
      .db("doctorPortalDB")
      .collection("appointments");
    const bookingCollection = client
      .db("doctorPortalDB")
      .collection("bookings");
    const userCollection = client
      .db("doctorPortalDB")
      .collection("user");
    const doctorsCollection = client
      .db("doctorPortalDB")
      .collection("doctors");
    const paymentsCollection = client
      .db("doctorPortalDB")
      .collection("payments");


    const verifyAdmin = async (req, res, next) => {
      console.log(req.decoded.email);
      const decodedEmail = req.decoded.email;
      const query = {email: decodedEmail}
      const user = await userCollection.findOne(query)

      if(user?.role !== 'admin'){
        return res.status(403).send({message: 'forbidden access'})
      }
      next()
    }

    app.get("/appointments", async (req, res) => {
      const date = req.query.date;
      console.log(date);
      const query = {};
      const options = await appointmentOptions.find(query).toArray();
      const bookingQuery = { appointmentData: date };
      const alreadyBooked = await bookingCollection
        .find(bookingQuery)
        .toArray();
      options.forEach((option) => {
        const optionBooked = alreadyBooked.filter(
          (book) => book.treatmentName == option.name
        );
        const bookSlots = optionBooked.map((book) => book.slot);
        const remainingSlots = option.slots.filter(
          (slot) => !bookSlots.includes(slot)
        );
        option.slots = remainingSlots;
        console.log(date, option.name, remainingSlots.length);
      });
      res.send(options);
    });

    // app.get("/v2/appointments", async (req, res) => {
    //   const date = req.query.date;
    //   const options = await appointmentOptions
    //     .aggregate([
    //       {
    //         $lookup: {
    //           from: "bookings",
    //           localField: "name",
    //           foreignField: "booking",
    //           pipeline: [
    //             {
    //               $match: {
    //                 $expr: {
    //                   $eq: ["$appointmentData", date],
    //                 },
    //               },
    //             },
    //           ],
    //           as: "booked",
    //         },
    //       },
    //       {
    //         $project: {
    //           name: 1,
    //           slots: 1,
    //           booked: {
    //             $map: {
    //               input: "$booked",
    //               as: "book",
    //               in: "$$book.slot",
    //             },
    //           },
    //         },
    //       },
    //       {
    //         $project: {
    //           name: 1,
    //           slots: {
    //             $setDifference: ["$slots", "$booked"],
    //           },
    //         },
    //       },
    //     ])
    //     .toArray();
    //   res.send(options);
    // });

    app.get('/bookings', verifyJWT, async (req, res) => {
      const email = req.query.email
      const decodedEmail = req.decoded.email;
      if(email !== decodedEmail){
        return res.status(403).send({message: "forbidden access"})
      }
      const query = {email : email}
      const result = await bookingCollection.find(query).toArray();
      res.send(result)
    })

    app.get('/bookings/:id', async (req, res) => {
      const id = req.params.id;
      const query = {_id: ObjectId(id)}
      const booking = await bookingCollection.findOne(query)
      res.send(booking)
    })

    app.post("/bookings", async (req, res) => {
      const booking = req.body;
      const query = {
        appointmentData: booking.appointmentData,
        email: booking.email,
        treatmentName: booking.treatmentName
      }
      const alreadyBooked = await bookingCollection.find(query).toArray()

      if(alreadyBooked.length){
        const message =`You already have a booked on ${booking.appointmentData}`
        return res.send({acknowledged: false, message})
      }
      const result = await bookingCollection.insertOne(booking);
      res.send(result);
    });

    app.get('/appointmentDoctor', async (req, res) =>{
      const query = {};
      const result = await appointmentOptions.find(query).project({name:1}).toArray()
      res.send(result)

    })

    app.post("/create-payment-intent", async (req, res) => {
      const booking = req.body;
      const price = booking.price;
      const amount = price*100;

      const paymentIntent = await stripe.paymentIntents.create({
        currency: 'usd',
        amount: amount,
        "payment_method_types": [
          "card"
        ],
      });
      res.send({
        clientSecret: paymentIntent.client_secret,
      });
    })

    app.post('/payments' , async(req, res) => {
      const payments = req.body
      const result = await paymentsCollection.insertOne(payments);
      const id = payments.bookingId
      const query = {_id: ObjectId(id)}
      const updateDoc = {
        $set: {
          paid: true,
          transactionId: payments.transactionId
        }
      }
      const updaterResult = await bookingCollection.updateOne(query, updateDoc, )
      res.send(result)
    })

    app.get('/jwt', async(req, res) => {
      const email = req.query.email;
      const query = {email: email}
      const user = await userCollection.findOne(query)
      console.log(user);
      if(user){
        console.log(user);
        const token = jwt.sign({email}, process.env.ACCESS_TOKEN, {expiresIn: '1h'})
        return res.send({accessToken: token})
      }
      res.status(403).send({accessToken: ''})
    })

    app.get('/users', async (req, res) => {
      const query = {};
      const users = await userCollection.find(query).toArray()
      res.send(users)
    })

    app.get('/users/admin/:email', async(req, res) => {
      const email = req.params.email;
      const query = {email}
      const user = await userCollection.findOne(query)
      res.send({isAdmin: user?.role === 'admin'});
    })

    app.post('/users', async (req, res) => {
      const user = req.body;
      const result = await userCollection.insertOne(user);
      res.send(result)
    })

    app.put('/users/admin/:id', verifyJWT, verifyAdmin, async(req, res) => {
      const id = req.params.id;
      const filter = {_id: ObjectId(id)}
      const options = {upsert: true}
      const updateDoc = {
        $set: {
          role: 'admin'
        }
      }
      const result = await userCollection.updateOne(filter, updateDoc, options)
      res.send(result);
    })

    app.get('/doctors', verifyJWT, verifyAdmin, async(req, res) => {
      const query= {};
      const doctors = await doctorsCollection.find(query).toArray();
      res.send(doctors)
    })

    app.post('/doctors', verifyJWT, verifyAdmin, async(req, res) => {
      const doctor =req.body;
      const result = await doctorsCollection.insertOne(doctor);
      res.send(result)
    })
    
    app.delete('/doctors/:id', verifyJWT, verifyAdmin, async (req, res) => {
      const id  = req.params.id
      const query = {_id: ObjectId(id)}
      const result = await doctorsCollection.deleteOne(query)
      res.send(result)
    })

    // app.get('/addprice', async (req , res) => {
    //   const filter = {}
    //   const options = {upsert:true}
    //   const updateDoc = {
    //     $set: {
    //       price: 99
    //     }
    //   }
    //   const result = await appointmentOptions.updateMany(filter, updateDoc, options);
    //   res.send(result)
    // })

  } finally {
  }
}
run().catch(console.log);

app.get("/", async (req, res) => {
  res.send("Doctors Portal Server Running");
});

app.listen(port, () => console.log(`Doctor Portal Port ${port}`));
